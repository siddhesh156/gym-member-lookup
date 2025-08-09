// client/src/App.js
import React, { useEffect, useState, useRef } from "react";
import { format, differenceInDays } from "date-fns";
import "./index.css";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:5000/api";

export default function App() {
  const [data, setData] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [member, setMember] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const expiryTimerRef = useRef(null);

  useEffect(() => {
    // Try to fetch data on mount; if 401, attempt refresh then retry
    checkSessionAndLoad();
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiFetch(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      credentials: "include",
      headers: { ...(opts.headers || {}), "Content-Type": "application/json" },
    });
    return res;
  }

  async function tryRefresh() {
    try {
      const r = await apiFetch("/refresh", { method: "POST" });
      if (!r.ok) return false;
      const json = await r.json();
      scheduleAutoLogout(json.expiresIn);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleAutoLogout(expiresInSec) {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    // add small buffer (2s)
    expiryTimerRef.current = setTimeout(() => {
      alert("Session expired — please login again.");
      setIsLoggedIn(false);
      setData([]);
      setMember(null);
    }, Math.max((expiresInSec || 60) * 1000 - 2000, 0));
  }

  async function checkSessionAndLoad() {
    setLoading(true);
    try {
      const r = await apiFetch("/data", { method: "GET" });
      if (r.status === 401) {
        // try refresh
        const ok = await tryRefresh();
        if (!ok) {
          setIsLoggedIn(false);
          setData([]);
          return;
        }
        // retry fetch
        const retry = await apiFetch("/data", { method: "GET" });
        if (!retry.ok) {
          setIsLoggedIn(false);
          setData([]);
          return;
        }
        const json = await retry.json();
        setData(json);
        setIsLoggedIn(true);
        // get expiry from refresh response earlier? We called tryRefresh which scheduled timer
      } else if (!r.ok) {
        setIsLoggedIn(false);
        setData([]);
      } else {
        const json = await r.json();
        setData(json);
        setIsLoggedIn(true);
      }
    } catch (err) {
      setIsLoggedIn(false);
      setData([]);
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
      scheduleAutoLogout(json.expiresIn);
      // load data
      const dataRes = await apiFetch("/data", { method: "GET" });
      if (!dataRes.ok) throw new Error("Failed to load data");
      const members = await dataRes.json();
      setData(members);
      setIsLoggedIn(true);
      setLoginForm({ username: "", password: "" });
    } catch (err) {
      setLoginError(err.message?.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch("/logout", { method: "POST" });
    } catch (err) {
      // ignore
    } finally {
      setIsLoggedIn(false);
      setData([]);
      setMember(null);
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    }
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) {
      setMember(null);
      return;
    }

    let found = null;
    if (/^\d+$/.test(searchTerm.trim())) {
      found = data.find((m) => String(m.ID) === searchTerm.trim());
    } else {
      const q = searchTerm.trim().toLowerCase();
      found = data.find((m) => (m.Name || "").toLowerCase() === q) || data.find((m) => (m.Name || "").toLowerCase().includes(q));
    }
    setMember(found || null);
  };

  const renderCard = () => {
    if (!member) return <p className="not-found fade-in">No member found</p>;

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
          {member["Image"] ? <img src={member["Image"]} alt="User" className="avatar" /> : <div className="avatar initials">{initials}</div>}
          <div className="member-meta">
            <h2 className="member-name">{member["Name"]}</h2>
            <div className="badges">
              <span className={`badge ${statusClass === "status-green" ? "badge-active" : ""}`}>
                {statusClass === "status-green" ? "Active" : statusClass === "status-yellow" ? "Expiring" : "Expired"}
              </span>
              {member["Locker"] && <span className="badge">Locker {member["Locker"]}</span>}
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
            <div className="value">{isNaN(startDate) ? "—" : format(startDate, "dd MMM yyyy")}</div>
          </div>
          <div className="info-row">
            <div className="label">Expiry</div>
            <div className="value">{isNaN(expiryDate) ? "—" : format(expiryDate, "dd MMM yyyy")}</div>
          </div>

          {daysLeft <= 0 ? <p className="expired">Membership Expired</p> : daysLeft <= 5 ? <p className="warning">Ends in {daysLeft} days — consider renewal</p> : <p className="healthy">Good for {daysLeft} days</p>}
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
              <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="logo" className="logo" />
              <h2>Welcome back</h2>
              <p className="sub">Sign in to access member lookup</p>
            </div>

            <input type="text" placeholder="Username" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} required />
            <input type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} required />
            <button className="btn-primary" type="submit">{loading ? "Signing in..." : "Sign in"}</button>
            {loginError && <p className="error-text">{loginError}</p>}
          </form>
        ) : (
          <div className="app-shell">
            <header className="app-header">
              <h1>Gym Member Lookup</h1>
              <div className="header-actions">
                <button className="logout-button" onClick={handleLogout}>Logout</button>
              </div>
            </header>

            <main className="lookup-area">
              <form className="input-group" onSubmit={handleSubmit}>
                <input type="text" placeholder="Search by ID or Name" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                <button className="btn-primary" type="submit">Search</button>
              </form>

              <div className="result-area">{loading ? <p>Loading…</p> : renderCard()}</div>
            </main>
          </div>
        )}
      </div>
    </>
  );
}
