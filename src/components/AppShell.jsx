import React, { useState } from "react";

const navItems = [
  ["dashboard", "Dashboard", "Home", "D"],
  ["bills", "Bills", "Bills", "B"],
  ["calendar", "Calendar", "Calendar", "C"],
  ["loan", "Loan", "Loan", "L"],
  ["scenarios", "Scenarios", "What if", "S"],
  ["stress", "Stress Test", "Stress", "T"],
  ["archive", "Archive", "Archive", "A"],
  ["setup", "Setup", "Setup", "U"],
];

const mobilePrimary = ["dashboard", "bills", "loan", "archive", "setup"];
const mobileMore = ["calendar", "scenarios", "stress"];

function cloudLabel(cloud) {
  if (!cloud?.configured) return "Local";
  if (cloud.saving) return "Saving";
  if (cloud.conflict) return "Refresh";
  if (cloud.householdId) return `Cloud r${cloud.revision ?? "-"}`;
  if (cloud.session) return "Sign in";
  return "Local";
}

function getPageLabel(page) {
  return navItems.find(([id]) => id === page)?.[1] || "Dashboard";
}

function NavButton({ item, page, alertCount, onClick, compact = false }) {
  const [id, label, mobileLabel, shortcut] = item;
  return (
    <button className={`${page === id ? "active" : ""} ${id === "setup" ? "config-nav" : ""}`} onClick={onClick}>
      {compact && <span className="nav-icon" aria-hidden="true">{shortcut}</span>}
      <span>{compact ? mobileLabel : label}</span>
      {id === "dashboard" && alertCount > 0 && <span className="nav-alert">{alertCount}</span>}
    </button>
  );
}

export default function AppShell({ page, setPage, household, alertCount, cloud, children }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryItems = navItems.filter(([id]) => mobilePrimary.includes(id));
  const moreItems = navItems.filter(([id]) => mobileMore.includes(id));
  const moreActive = mobileMore.includes(page);

  const go = (id) => {
    setPage(id);
    setMoreOpen(false);
  };

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
        <button className={`sync-chip ${cloud?.householdId ? "connected" : ""} ${cloud?.conflict ? "conflict" : ""}`} onClick={() => go("setup")}>
          {cloudLabel(cloud)}
        </button>
        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => (
            <NavButton item={item} page={page} alertCount={alertCount} key={item[0]} onClick={() => go(item[0])} />
          ))}
        </nav>
      </aside>

      <header className="mobile-topbar">
        <div>
          <strong>{getPageLabel(page)}</strong>
          <small>{household.householdName}</small>
        </div>
        <button className={`sync-chip mobile-sync ${cloud?.householdId ? "connected" : ""} ${cloud?.conflict ? "conflict" : ""}`} onClick={() => go("setup")}>
          {cloudLabel(cloud)}
        </button>
      </header>

      <main className="main-panel">{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
        {primaryItems.map((item) => (
          <NavButton item={item} page={page} alertCount={alertCount} key={item[0]} compact onClick={() => go(item[0])} />
        ))}
        <button className={`${moreActive || moreOpen ? "active" : ""}`} onClick={() => setMoreOpen((current) => !current)}>
          <span className="nav-icon" aria-hidden="true">+</span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-more-panel">
          <div className="mobile-more-card">
            <div className="panel-heading">
              <h2>More tools</h2>
              <button className="link-button" onClick={() => setMoreOpen(false)}>Close</button>
            </div>
            <div className="mobile-more-grid">
              {moreItems.map((item) => (
                <NavButton item={item} page={page} alertCount={alertCount} key={item[0]} onClick={() => go(item[0])} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
