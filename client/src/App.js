// client/src/App.js
import React, { useState, useEffect } from "react";
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

  const logout = () => {
    localStorage.removeItem("token");
    setIsLoggedIn(false);
    setData([]);
    setMember(null);
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE}/data`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        return res.json();
      })
      .then((json) => {
        const [headers, ...rows] = json.values;
        const records = rows.map((row) =>
          Object.fromEntries(row.map((val, i) => [headers[i], val]))
        );
        setData(records);
        setIsLoggedIn(true);
      })
      .catch(() => logout());
  }, []);

  const handleSubmit = () => {
    let foundMember;

    if (/^\d+$/.test(searchTerm.trim())) {
      // Search by numeric ID
      foundMember = data.find((m) => String(m.ID) === searchTerm.trim());
    } else {
      // Search by name (case-insensitive)
      foundMember = data.find(
        (m) => m.Name.toLowerCase() === searchTerm.trim().toLowerCase()
      );
    }

    setMember(foundMember || null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      if (!res.ok) throw new Error("Login failed");
      const { token } = await res.json();
      localStorage.setItem("token", token);
      setLoginError("");
      window.location.reload();
    } catch (err) {
      setLoginError("Invalid username or password");
    }
  };

  const renderCard = () => {
    if (!member) return <p className="not-found">No member found</p>;

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
      <div className={`member-card ${statusClass}`}>
        {member["Image"] ? (
          <img src={member["Image"]} alt="User" className="avatar" />
        ) : (
          <div className="avatar initials">{initials}</div>
        )}
        <p>
          <strong>Name:</strong> {member["Name"]}
        </p>
        <p>
          <strong>Phone:</strong> {member["Phone Number"]}
        </p>
        <p>
          <strong>Membership Date:</strong> {format(startDate, "dd MMM yyyy")}
        </p>
        <p>
          <strong>Membership:</strong> {member["Status"]}
        </p>
        {member["Locker"] && (
          <p>
            <strong>Locker:</strong> {member["Locker"]}
          </p>
        )}
        <p>
          <strong>Expiry:</strong> {format(expiryDate, "dd MMM yyyy")}
        </p>
        {daysLeft <= 0 ? (
          <p className="expired">Membership Expired</p>
        ) : daysLeft <= 5 ? (
          <p className="warning">Ends in {daysLeft} days</p>
        ) : null}
      </div>
    );
  };

  // background watermark styling
  const bgStyle = {
    backgroundImage: `url(${process.env.PUBLIC_URL}/logo.png)`,
    backgroundRepeat: "repeat",
    backgroundSize: "100px",
    opacity: 0.1,
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    zIndex: -1,
    pointerEvents: "none",
  };

  if (!isLoggedIn) {
    return (
      <>
        <div style={bgStyle}></div> {/* background watermark */}
        <div className="container">
          <form className="login-form" onSubmit={handleLogin}>
            <h2>Login</h2>
            <input
              type="text"
              placeholder="Username"
              value={loginForm.username}
              onChange={(e) =>
                setLoginForm({ ...loginForm, username: e.target.value })
              }
            />
            <input
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) =>
                setLoginForm({ ...loginForm, password: e.target.value })
              }
            />
            <button type="submit">Login</button>
            {loginError && <p className="error-text">{loginError}</p>}
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={bgStyle}></div> {/* background watermark */}
      <div className="container">
        <h1>GYM Member Lookup</h1>
        <button onClick={logout} className="logout-button">
          Logout
        </button>
        <div className="input-group">
          <input
            type="text"
            placeholder="Enter Member ID"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button onClick={handleSubmit}>Search</button>
        </div>
        {renderCard()}
      </div>
    </>
  );
}
