import React from "react";

const navItems = [
  ["dashboard", "Dashboard"],
  ["bills", "Bills"],
  ["calendar", "Calendar"],
  ["loan", "Loan"],
  ["scenarios", "Scenarios"],
  ["stress", "Stress Test"],
  ["archive", "Archive"],
  ["setup", "Setup"],
];

function cloudLabel(cloud) {
  if (!cloud?.configured) return "Local";
  if (cloud.saving) return "Saving";
  if (cloud.conflict) return "Refresh";
  if (cloud.householdId) return `Cloud r${cloud.revision ?? "—"}`;
  if (cloud.session) return "Sign in";
  return "Local";
}

export default function AppShell({ page, setPage, household, alertCount, cloud, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>HF</span>
          <div>
            <strong>Household Finance OS</strong>
            <small>{household.householdName}</small>
          </div>
        </div>
        <button className={`sync-chip ${cloud?.householdId ? "connected" : ""} ${cloud?.conflict ? "conflict" : ""}`} onClick={() => setPage("setup")}>
          {cloudLabel(cloud)}
        </button>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map(([id, label]) => (
            <button className={`${page === id ? "active" : ""} ${id === "setup" ? "config-nav" : ""}`} key={id} onClick={() => setPage(id)}>
              {label}
              {id === "dashboard" && alertCount > 0 && <span className="nav-alert">{alertCount}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main-panel">{children}</main>
    </div>
  );
}
