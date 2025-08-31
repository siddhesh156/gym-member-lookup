// server/index.js
require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const crypto = require("crypto");
const { requestLogger, loginLogger } = require("./middleware/logger");
const app = express();

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);
app.use(loginLogger);

// CORS: allow your client origin and credentials
app.use(
  cors({
    origin: [process.env.CLIENT_ORIGIN, "http://localhost:3000","https://gym-member-lookup.vercel.app"],
    credentials: true,
  })
);

// Rate limiter: basic protection
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || "15m"; // short
const REFRESH_EXPIRES_DAYS = Number(process.env.REFRESH_EXPIRES_DAYS || 7); // refresh token lifetime
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;
const API_KEY = process.env.GOOGLE_API_KEY;
const USERNAME = process.env.LOGIN_USER;
const PASSWORD = process.env.LOGIN_PASS;

if (!USERNAME || !PASSWORD) {
  console.warn("WARNING: LOGIN_USER / LOGIN_PASS not set in .env");
}

// In-memory refresh token store: maps refreshToken -> { username, expiresAt }
// In production use DB
const refreshTokenStore = new Map();

// cookie options
const isProd = true // process.env.NODE_ENV === "production";
const cookieOptions = {
  httpOnly: true,
  secure: isProd, // set to true in production (requires https)
  sameSite: isProd ? "None" : "lax",
  // path: '/', // default
};

function generateRefreshToken() {
  return crypto.randomBytes(40).toString("hex");
}

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
}

/* Helper to fetch Google Sheet and return array of objects */
let cachedSheet = null;
let cacheExpires = 0;
const SHEET_CACHE_TTL_MS = Number(process.env.SHEET_CACHE_TTL_MS || 30 * 1000); // default 30s

async function fetchSheetAsObjects() {
  const now = Date.now();
  if (cachedSheet && cacheExpires > now) return cachedSheet;

  if (!SHEET_ID || !SHEET_NAME || !API_KEY) {
    throw new Error("Missing Sheets config");
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(
    SHEET_NAME
  )}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Sheets fetch failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const json = await res.json();
  if (!Array.isArray(json.values) || json.values.length < 1) return [];

  const [headersRow, ...rows] = json.values;
  const headers = headersRow.map((h) => String(h || "").trim());
  const objects = rows.map((row) => {
    const obj = {};
    headers.forEach((key, i) => {
      if (!key) return;
      obj[key] = row[i] !== undefined ? row[i] : "";
    });
    return obj;
  });

  cachedSheet = objects;
  cacheExpires = Date.now() + SHEET_CACHE_TTL_MS;
  return objects;
}

/* -- AUTH ROUTES -- */

/**
 * POST /api/login
 * Body: { username, password }
 * Sets HttpOnly cookies: access_token (JWT), refresh_token (random string)
 * Returns: { user, expiresIn } where expiresIn is seconds until access token expiry
 */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: "username/password required" });

  if (username === USERNAME && password === PASSWORD) {
    const accessToken = signAccessToken({ username });
    // decode to get expiry
    const decoded = jwt.decode(accessToken);
    const expiresInSec = decoded && decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 60 * 15;

    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;
    refreshTokenStore.set(refreshToken, { username, expiresAt: refreshExpiresAt });

    // set cookies
    res.cookie("access_token", accessToken, {
      ...cookieOptions,
      maxAge: expiresInSec * 1000,
    });
    res.cookie("refresh_token", refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
    });

    return res.json({ user: username, expiresIn: expiresInSec });
  }

  return res.status(401).json({ message: "Invalid credentials" });
});

/**
 * POST /api/refresh
 * Body: {}
 * Requires refresh_token cookie. Issues new access token (rotates or keeps refresh token).
 * Returns { expiresIn }
 */
app.post("/api/refresh", (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (!rt) return res.status(401).json({ message: "Missing refresh token" });

  const record = refreshTokenStore.get(rt);
  if (!record) return res.status(401).json({ message: "Invalid refresh token" });
  if (record.expiresAt < Date.now()) {
    refreshTokenStore.delete(rt);
    return res.status(401).json({ message: "Refresh token expired" });
  }

  // rotate: generate new refresh token (optional). Here we keep same refresh token to keep client simple
  const accessToken = signAccessToken({ username: record.username });
  const decoded = jwt.decode(accessToken);
  const expiresInSec = decoded && decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 60 * 15;

  res.cookie("access_token", accessToken, {
    ...cookieOptions,
    maxAge: expiresInSec * 1000,
  });

  return res.json({ user: record.username, expiresIn: expiresInSec });
});

/**
 * POST /api/logout
 * Clears cookies and invalidates refresh token
 */
app.post("/api/logout", (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (rt) refreshTokenStore.delete(rt);

  res.clearCookie("access_token", cookieOptions);
  res.clearCookie("refresh_token", cookieOptions);
  return res.json({ ok: true });
});

/* Auth middleware — looks up access_token cookie */
function authMiddleware(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ message: "Missing access token" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired access token" });
    req.user = decoded;
    next();
  });
}

/* Protected data endpoint */
app.get("/api/data", authMiddleware, async (req, res) => {
  try {
    const objects = await fetchSheetAsObjects();
    return res.json(objects);
  } catch (err) {
    console.error("Error reading sheet:", err.message || err);
    return res.status(500).json({ message: "Failed to fetch sheet data", error: err.message });
  }
});

app.get("/", (req, res) => res.send("Gym API running"));

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
