// client/src/App.js
import React, { useEffect, useState, useRef } from "react";
import { format, differenceInDays } from "date-fns";
import "./index.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000/api";

export default function App() {
  const [data, setData] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [member, setMember] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false); // 👈 for password toggle
  const expiryTimerRef = useRef(null);
  const debounceRef = useRef(null); // 👈 for debounce

  useEffect(() => {
    checkSessionAndLoad();
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiFetch(path, opts = {}) {
    let token = localStorage.getItem("access_token");
    const expiry = localStorage.getItem("access_expiry");

    // if expired → try refresh
    if (expiry && Date.now() > expiry) {
      const ok = await refreshToken();
      if (!ok) throw new Error("Session expired");
      token = localStorage.getItem("access_token");
    }

    const headers = {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
    });

    // if unauthorized → attempt refresh once
    if (res.status === 401) {
      const ok = await refreshToken();
      if (ok) {
        return apiFetch(path, opts); // retry with new token
      } else {
        throw new Error("Unauthorized");
      }
    }

    return res;
  }

  function scheduleAutoLogout(expiresInSec) {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = setTimeout(() => {
      alert("Session expired — please login again.");
      setIsLoggedIn(false);
      setData([]);
      setMember([]);
      setSearchTerm("");
    }, Math.max((expiresInSec || 60) * 1000 - 2000, 0));
  }

  async function checkSessionAndLoad() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setIsLoggedIn(false);
      return;
    }
    setLoading(true);
    try {
      const r = await apiFetch("/data");
      if (!r.ok) throw new Error("Not authorized");
      const json = await r.json();
      setData(json);
      setIsLoggedIn(true);
    } catch {
      handleLogout();
    } finally {
      setLoading(false);
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      const res = await apiFetch("/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || "Login failed");
      }
      const json = await res.json();

      // 👉 Save tokens in localStorage
      localStorage.setItem("access_token", json.accessToken);
      localStorage.setItem("refresh_token", json.refreshToken);
      localStorage.setItem("access_expiry", Date.now() + json.expiresIn * 1000);

      scheduleAutoLogout(json.expiresIn);

      const dataRes = await apiFetch("/data");
      if (!dataRes.ok) throw new Error("Failed to load data");
      const members = await dataRes.json();
      setData(members);
      setIsLoggedIn(true);
      setLoginForm({ username: "", password: "" });
    } catch (err) {
      setLoginError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  async function refreshToken() {
    const refresh = localStorage.getItem("refresh_token");
    if (!refresh) return false;
    try {
      const res = await fetch(`${API_BASE}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) throw new Error("Refresh failed");
      const json = await res.json();

      // save new tokens
      localStorage.setItem("access_token", json.accessToken);
      localStorage.setItem("access_expiry", Date.now() + json.expiresIn * 1000);

      scheduleAutoLogout(json.expiresIn);
      return true;
    } catch (err) {
      console.error("Refresh error:", err);
      handleLogout();
      return false;
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("access_expiry");
    setIsLoggedIn(false);
    setData([]);
    setMember([]);
    setSearchTerm("");
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
  };

  // 👇 runs when searchTerm changes, but waits 400ms before applying
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleSubmit();
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const handleSubmit = () => {
    if (!searchTerm.trim()) {
      setMember([]);
      return;
    }

    let found = [];
    if (/^\d+$/.test(searchTerm.trim())) {
      found = data.find((m) => String(m.ID) === searchTerm.trim());
    } else {
      const q = searchTerm.trim().toLowerCase();
      found = data.filter((m) => (m.Name || "").toLowerCase().includes(q));
    }
    setMember(found || []);
  };

  const renderCard = (member) => {
    const expiryDate = new Date(member["Membership Expiry"]);
    const startDate = new Date(member["Membership Date"]);
    const today = new Date();
    const daysLeft = differenceInDays(expiryDate, today);

    let statusClass = "status-green";
    if (daysLeft <= 5 && daysLeft > 0) statusClass = "status-yellow";
    if (daysLeft <= 0) statusClass = "status-red";

    const initials = member["Name"]
      ? member["Name"]
          .split(" ")
          .map((n) => n[0].toUpperCase())
          .join("")
      : "U";

    return (
      <div className={`member-card ${statusClass} card-animate`}>
        <div className="card-top">
          {member["Image"] ? (
            <img src={member["Image"]} alt="User" className="avatar" />
          ) : (
            <div className="avatar initials">{initials}</div>
          )}
          <div className="member-meta">
            <h2 className="member-name">{member["Name"]}</h2>
            <div className="badges">
              <span
                className={`badge ${
                  statusClass === "status-green" ? "badge-active" : ""
                }`}
              >
                {statusClass === "status-green"
                  ? "Active"
                  : statusClass === "status-yellow"
                  ? "Expiring"
                  : "Expired"}
              </span>
              {member["Locker"] && (
                <span className="badge">Locker {member["Locker"]}</span>
              )}
            </div>
          </div>
        </div>

        <div className="card-body">
          <div className="info-row">
            <div className="label">Phone</div>
            <div className="value">{member["Phone Number"] || "—"}</div>
          </div>
          <div className="info-row">
            <div className="label">Joined</div>
            <div className="value">
              {isNaN(startDate) ? "—" : format(startDate, "dd MMM yyyy")}
            </div>
          </div>
          <div className="info-row">
            <div className="label">Expiry</div>
            <div className="value">
              {isNaN(expiryDate) ? "—" : format(expiryDate, "dd MMM yyyy")}
            </div>
          </div>

          {daysLeft <= 0 ? (
            <p className="expired">Membership Expired</p>
          ) : daysLeft <= 5 ? (
            <p className="warning">
              Ends in {daysLeft} days — consider renewal
            </p>
          ) : (
            <p className="healthy">Good for {daysLeft} days</p>
          )}
        </div>
      </div>
    );
  };

  const bgStyle = {
    backgroundImage: `url(${process.env.PUBLIC_URL}/logo.png)`,
    backgroundRepeat: "repeat",
    backgroundSize: "120px",
    opacity: 0.03,
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    zIndex: -1,
    pointerEvents: "none",
  };

  return (
    <>
      <div style={bgStyle}></div>
      <div className="container fade-in">
        {!isLoggedIn ? (
          <form className="login-form glass-card" onSubmit={handleLogin}>
            <div className="brand">
              <img
                src={`${process.env.PUBLIC_URL}/logo.png`}
                alt="logo"
                className="logo"
              />
              <h2>Welcome back</h2>
              <p className="sub">Sign in to access member lookup</p>
            </div>

            <input
              type="text"
              placeholder="Username"
              value={loginForm.username}
              onChange={(e) =>
                setLoginForm({ ...loginForm, username: e.target.value })
              }
              required
            />

            {/* 👇 password input with toggle */}
            <div className="password-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={loginForm.password}
                onChange={(e) =>
                  setLoginForm({ ...loginForm, password: e.target.value })
                }
                required
              />
              <span
                className="toggle-password"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? "🙈" : "👁️"}
              </span>
            </div>

            <button className="btn-primary" type="submit">
              {loading ? "Signing in..." : "Sign in"}
            </button>
            {loginError && <p className="error-text">{loginError}</p>}
          </form>
        ) : (
          <div className="app-shell">
            <header className="app-header">
              <h1>Gym Member Lookup</h1>
              <div className="header-actions">
                <button className="logout-button" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            </header>

            <main className="lookup-area">
              {/* 👇 removed search button, input auto triggers search with debounce */}
              <form
                className="input-group"
                onSubmit={(e) => e.preventDefault()}
              >
                <div
                  className="search-wrapper"
                  style={{ position: "relative", width: "100%" }}
                >
                  <input
                    type="text"
                    placeholder="Search by ID or Name"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: "100%", paddingRight: "2rem" }} // space for the X button
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm("");
                        setMember([]); // also clear results
                      }}
                      className="clear-btn"
                      style={{
                        position: "absolute",
                        right: "0.5rem",
                        top: "50%",
                        transform: "translateY(-50%)",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: "1.2rem",
                        color: "#666",
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </form>
              <div className="result-area">
                {loading ? (
                  <p>Loading…</p>
                ) : member.length > 0 ? (
                  <div className="results-grid">{member.map(renderCard)}</div>
                ) : (
                  <p className="not-found fade-in">No member found</p>
                )}
              </div>
            </main>
          </div>
        )}
      </div>
    </>
  );
}
