"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

type Tab = "login" | "create";

// Mirrors src/lib/dashboardSignupPolicy.ts — server-side validation is authoritative.
function isGrataEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) return false;
  return normalized.slice(normalized.lastIndexOf("@") + 1) === "grata.life";
}

export default function LoginPage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [tab,      setTab]      = useState<Tab>("login");

  // Login form
  const [username,   setUsername]   = useState("");
  const [password,   setPassword]   = useState("");
  const [loginErr,   setLoginErr]   = useState("");
  const [loginBusy,  setLoginBusy]  = useState(false);

  // Create form
  const [newUsername, setNewUsername] = useState("");
  const [newDisplay,  setNewDisplay]  = useState("");
  const [newPass,     setNewPass]     = useState("");
  const [newConfirm,  setNewConfirm]  = useState("");
  const [createErr,   setCreateErr]   = useState("");
  const [createBusy,  setCreateBusy]  = useState(false);
  const [createMsg,   setCreateMsg]   = useState("");

  // If already authenticated, go straight to dashboard.
  useEffect(() => {
    fetch("/api/dashboard/operators/me")
      .then(r => r.json())
      .then(d => {
        if (d.operator) router.replace("/dashboard");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  function switchTab(t: Tab) {
    setTab(t);
    setLoginErr("");
    setCreateErr("");
    setCreateMsg("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginErr("");
    try {
      const res  = await fetch("/api/dashboard/operators/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.profile) {
        setLoginErr(data.error ?? "Login failed. Check your credentials.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setLoginErr("Network error — please try again.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr("");
    setCreateMsg("");
    if (!isGrataEmail(newUsername)) {
      setCreateErr("Only Grata email addresses can create dashboard profiles.");
      return;
    }
    if (newPass.length < 8) {
      setCreateErr("Password must be at least 8 characters.");
      return;
    }
    if (newPass !== newConfirm) {
      setCreateErr("Passwords do not match.");
      return;
    }
    setCreateBusy(true);
    try {
      const res  = await fetch("/api/dashboard/operators/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username:        newUsername.trim().toLowerCase(),
          displayName:     newDisplay.trim() || null,
          password:        newPass,
          confirmPassword: newConfirm,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.profile) {
        setCreateErr(data.error ?? "Failed to create profile.");
        return;
      }
      // Auto-login with the new credentials.
      const loginRes = await fetch("/api/dashboard/operators/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim().toLowerCase(), password: newPass }),
      });
      if (loginRes.ok) {
        router.push("/dashboard");
      } else {
        // Auto-login failed — drop to login tab with a success hint.
        setCreateMsg("Profile created! Log in with your new credentials.");
        setUsername(newUsername.trim().toLowerCase());
        setPassword("");
        switchTab("login");
      }
    } catch {
      setCreateErr("Network error — please try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  if (checking) {
    return (
      <div className={styles.loginPage}>
        <div className={styles.loginCard}>
          <div className={styles.loginBrand}>
            <div className={styles.loginTitle}>Triage Dashboard</div>
          </div>
          <p className={styles.loginLoading}>Checking session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        {/* Brand */}
        <div className={styles.loginBrand}>
          <div className={styles.loginTitle}>Triage Dashboard</div>
          <div className={styles.loginSubtitle}>Grata / Speer Operations</div>
        </div>

        {/* Tabs */}
        <div className={styles.loginTabs}>
          <button
            className={`${styles.loginTab} ${tab === "login" ? styles.loginTabActive : ""}`}
            onClick={() => switchTab("login")}
          >
            Log In
          </button>
          <button
            className={`${styles.loginTab} ${tab === "create" ? styles.loginTabActive : ""}`}
            onClick={() => switchTab("create")}
          >
            Create Profile
          </button>
        </div>

        {/* Log In form */}
        {tab === "login" && (
          <form className={styles.loginForm} onSubmit={handleLogin} noValidate>
            {createMsg && <div className={styles.loginSuccess}>{createMsg}</div>}
            <label className={styles.loginLabel}>
              <span className={styles.loginLabelText}>Email or username</span>
              <input
                className={styles.loginInput}
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>
            <label className={styles.loginLabel}>
              <span className={styles.loginLabelText}>Password</span>
              <input
                className={styles.loginInput}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {loginErr && <div className={styles.loginErr}>{loginErr}</div>}
            <button className={styles.loginBtn} type="submit" disabled={loginBusy}>
              {loginBusy ? "Logging in…" : "Log In"}
            </button>
          </form>
        )}

        {/* Create Profile form */}
        {tab === "create" && (
          <form className={styles.loginForm} onSubmit={handleCreate} noValidate>
            <label className={styles.loginLabel}>
              <span className={styles.loginLabelText}>Grata email</span>
              <input
                className={styles.loginInput}
                type="email"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="you@grata.life"
                autoComplete="email"
                autoFocus
                required
              />
            </label>
            <label className={styles.loginLabel}>
              <span className={styles.loginLabelText}>
                Display name <span className={styles.loginOptional}>(optional)</span>
              </span>
              <input
                className={styles.loginInput}
                type="text"
                value={newDisplay}
                onChange={e => setNewDisplay(e.target.value)}
                autoComplete="name"
              />
            </label>
            <label className={styles.loginLabel}>
              <span className={styles.loginLabelText}>Password</span>
              <input
                className={styles.loginInput}
                type="password"
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <label className={styles.loginLabel}>
              <span className={styles.loginLabelText}>Confirm password</span>
              <input
                className={styles.loginInput}
                type="password"
                value={newConfirm}
                onChange={e => setNewConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            {createErr && <div className={styles.loginErr}>{createErr}</div>}
            <button className={styles.loginBtn} type="submit" disabled={createBusy}>
              {createBusy ? "Creating…" : "Create Profile"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
