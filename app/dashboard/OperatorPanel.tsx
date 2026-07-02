"use client";

import { useState, useEffect } from "react";
import styles from "./dashboard.module.css";

export interface OperatorInfo {
  id: string;
  username: string;
  displayName: string | null;
}

interface Props {
  onOperatorChange: (op: OperatorInfo | null) => void;
}

type Mode = "loading" | "loggedIn" | "login" | "create";

interface ProfileOption {
  id: string;
  username: string;
  displayName: string | null;
}

export default function OperatorPanel({ onOperatorChange }: Props) {
  const [mode,     setMode]     = useState<Mode>("loading");
  const [active,   setActive]   = useState<OperatorInfo | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);

  // Login form state
  const [selUsername, setSelUsername] = useState("");
  const [password,    setPassword]    = useState("");
  const [loginErr,    setLoginErr]    = useState("");
  const [loginBusy,   setLoginBusy]   = useState(false);

  // Create form state
  const [newUsername, setNewUsername] = useState("");
  const [newDisplay,  setNewDisplay]  = useState("");
  const [newPass,     setNewPass]     = useState("");
  const [newConfirm,  setNewConfirm]  = useState("");
  const [createErr,   setCreateErr]   = useState("");
  const [createBusy,  setCreateBusy]  = useState(false);

  // On mount: check current session + load profile list
  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/operators/me").then(r => r.json()),
      fetch("/api/dashboard/operators").then(r => r.json()),
    ]).then(([meData, listData]) => {
      const op: OperatorInfo | null = meData.operator ?? null;
      const profs: ProfileOption[]   = listData.profiles ?? [];
      setProfiles(profs);
      if (op) {
        setActive(op);
        onOperatorChange(op);
        setMode("loggedIn");
      } else {
        setMode(profs.length === 0 ? "create" : "login");
      }
    }).catch(() => setMode("login"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetLoginForm() {
    setPassword("");
    setLoginErr("");
  }

  function resetCreateForm() {
    setNewUsername("");
    setNewDisplay("");
    setNewPass("");
    setNewConfirm("");
    setCreateErr("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selUsername) { setLoginErr("Select a profile"); return; }
    if (!password)    { setLoginErr("Password required"); return; }
    setLoginBusy(true);
    setLoginErr("");
    try {
      const res  = await fetch("/api/dashboard/operators/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: selUsername, password }),
      });
      const data = (await res.json()) as { profile?: OperatorInfo; error?: string };
      if (!res.ok || !data.profile) {
        setLoginErr(data.error ?? "Login failed");
        return;
      }
      setActive(data.profile);
      onOperatorChange(data.profile);
      setMode("loggedIn");
      resetLoginForm();
    } catch {
      setLoginErr("Network error");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateErr("");
    try {
      const res  = await fetch("/api/dashboard/operators/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username:        newUsername.trim(),
          displayName:     newDisplay.trim() || null,
          password:        newPass,
          confirmPassword: newConfirm,
        }),
      });
      const data = (await res.json()) as { profile?: ProfileOption; error?: string };
      if (!res.ok || !data.profile) {
        setCreateErr(data.error ?? "Failed to create profile");
        return;
      }
      // Refresh profile list then switch to login (auto-log-in with the new profile)
      const loginRes  = await fetch("/api/dashboard/operators/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPass }),
      });
      const loginData = (await loginRes.json()) as { profile?: OperatorInfo; error?: string };
      if (loginData.profile) {
        setActive(loginData.profile);
        onOperatorChange(loginData.profile);
        setProfiles(prev => [...prev, data.profile!].sort((a, b) => a.username.localeCompare(b.username)));
        setMode("loggedIn");
        resetCreateForm();
      } else {
        setCreateErr("Profile created but login failed — try logging in manually");
        setMode("login");
      }
    } catch {
      setCreateErr("Network error");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/dashboard/operators/logout", { method: "POST" });
    setActive(null);
    onOperatorChange(null);
    setMode(profiles.length === 0 ? "create" : "login");
    resetLoginForm();
  }

  function startSwitch() {
    resetLoginForm();
    setMode("login");
  }

  const displayLabel = active
    ? (active.displayName ? `${active.displayName} (${active.username})` : active.username)
    : null;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (mode === "loading") {
    return (
      <div className={styles.operatorBar}>
        <span className={styles.operatorLabel}>Operator:</span>
        <span className={styles.muted}>Loading…</span>
      </div>
    );
  }

  if (mode === "loggedIn") {
    return (
      <div className={styles.operatorBar}>
        <span className={styles.operatorLabel}>Operator:</span>
        <span className={styles.operatorName}>{displayLabel}</span>
        <button className={styles.operatorBtn} onClick={startSwitch}>Switch</button>
        <button className={styles.operatorBtnSecondary} onClick={handleLogout}>Log out</button>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className={styles.operatorPanel}>
        <form className={styles.operatorForm} onSubmit={handleCreate}>
          <span className={styles.operatorFormLabel}>
            {profiles.length === 0 ? "Create first operator profile" : "New profile"}
          </span>
          <input
            className={styles.operatorInput}
            placeholder="Username"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <input
            className={styles.operatorInput}
            placeholder="Display name (optional)"
            value={newDisplay}
            onChange={e => setNewDisplay(e.target.value)}
          />
          <input
            className={styles.operatorInput}
            type="password"
            placeholder="Password (min 8)"
            value={newPass}
            onChange={e => setNewPass(e.target.value)}
            autoComplete="new-password"
            required
          />
          <input
            className={styles.operatorInput}
            type="password"
            placeholder="Confirm password"
            value={newConfirm}
            onChange={e => setNewConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          <button className={styles.operatorBtn} type="submit" disabled={createBusy}>
            {createBusy ? "Creating…" : "Create"}
          </button>
          {profiles.length > 0 && (
            <button
              className={styles.operatorBtnSecondary}
              type="button"
              onClick={() => { resetCreateForm(); setMode("login"); }}
            >
              Cancel
            </button>
          )}
          {createErr && <span className={styles.operatorErr}>{createErr}</span>}
        </form>
      </div>
    );
  }

  // mode === "login" (or "switch")
  return (
    <div className={styles.operatorPanel}>
      <form className={styles.operatorForm} onSubmit={handleLogin}>
        <span className={styles.operatorFormLabel}>
          {active ? "Switch operator" : "Log in"}
        </span>
        <select
          className={styles.operatorSelect}
          value={selUsername}
          onChange={e => setSelUsername(e.target.value)}
          required
        >
          <option value="">Select profile…</option>
          {profiles.map(p => (
            <option key={p.id} value={p.username}>
              {p.displayName ? `${p.displayName} (${p.username})` : p.username}
            </option>
          ))}
        </select>
        <input
          className={styles.operatorInput}
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button className={styles.operatorBtn} type="submit" disabled={loginBusy}>
          {loginBusy ? "…" : "→"}
        </button>
        <button
          className={styles.operatorBtnSecondary}
          type="button"
          onClick={() => { resetLoginForm(); setMode("create"); }}
        >
          New profile
        </button>
        {active && (
          <button
            className={styles.operatorBtnSecondary}
            type="button"
            onClick={() => { resetLoginForm(); setMode("loggedIn"); }}
          >
            Cancel
          </button>
        )}
        {loginErr && <span className={styles.operatorErr}>{loginErr}</span>}
      </form>
    </div>
  );
}
