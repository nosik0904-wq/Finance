import React, { useMemo, useState } from "react";
import { currency, daysBetween, shortDate } from "../logic/financeCalculations";
import { formatActionLogEntry } from "../logic/auditTrail";

export default function Archive({ state, today }) {
  const [mode, setMode] = useState("recent");
  const archive = state.archive || [];
  const fullArchive = state.debug?.fullArchive?.length ? state.debug.fullArchive : archive;
  const actionLog = state.debug?.actionLog || [];

  const visible = useMemo(() => {
    const source = mode === "full" ? fullArchive : archive.filter((item) => daysBetween(item.paidDate, today) <= 90);
    return [...source].sort((a, b) => String(b.paidDate || "").localeCompare(String(a.paidDate || "")));
  }, [archive, fullArchive, mode, today]);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Archive and debug trail</p>
          <h1>Paid bills and app actions</h1>
          <p className="section-copy">The normal view stays short, but the full paid archive and action log are kept for troubleshooting.</p>
        </div>
        <span className="pill">{fullArchive.length} saved records</span>
      </div>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Paid archive</h2>
            <p className="helper-text">Recent view is the last 90 days. Full view is what gets saved in backup/debug exports.</p>
          </div>
          <div className="header-actions">
            <button className={mode === "recent" ? "primary-action" : ""} onClick={() => setMode("recent")}>Last 90 days</button>
            <button className={mode === "full" ? "primary-action" : ""} onClick={() => setMode("full")}>Full saved archive</button>
          </div>
        </div>
        <div className="item-list">
          {visible.length ? visible.map((item) => (
            <div className="ledger-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <small>{shortDate(item.paidDate)} | {item.category} | covered by {item.paidBy || item.coveredBy || item.account}</small>
                {item.loanEstimate && <small>Loan estimate: principal {currency(item.loanEstimate.estimatedPrincipal)} · interest {currency(item.loanEstimate.estimatedInterest)}</small>}
              </div>
              <span>{currency(item.amount)}</span>
            </div>
          )) : <p className="empty-text">No paid records in this view yet.</p>}
        </div>
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>App action log</h2>
            <p className="helper-text">Every meaningful app change is saved here with before/after summaries so problems can be debugged.</p>
          </div>
          <span className="pill">{actionLog.length} entries</span>
        </div>
        <div className="item-list spacious-list">
          {actionLog.length ? actionLog.slice(0, 80).map((entry) => (
            <details className="ledger-row debug-row" key={entry.id}>
              <summary>
                <div>
                  <strong>{formatActionLogEntry(entry)}</strong>
                  <small>{entry.type} · {entry.source || "app"}{entry.detail ? " · " + entry.detail : ""}</small>
                </div>
              </summary>
              <pre className="debug-json">{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre>
            </details>
          )) : <p className="empty-text">No app actions logged yet.</p>}
        </div>
      </article>
    </section>
  );
}
