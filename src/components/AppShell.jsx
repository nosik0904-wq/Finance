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

export default function AppShell({ page, setPage, household, alertCount, children }) {
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
