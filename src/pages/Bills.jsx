import React, { useMemo, useState } from "react";
import StatusBadge from "../components/StatusBadge";
import { currency, shortDate } from "../logic/financeCalculations";
import { getBillVariance, getPartnerName } from "../logic/engine";

const recurrenceOptions = ["none", "weekly", "fortnightly", "monthly", "quarterly", "annually"];
const accountOptions = ["auto", "external", "offset", "offsetContribution"];
const statusOptions = ["confirmed", "autoAssumed", "flagged", "deferred", "partial", "unable to pay"];

export default function Bills({ state, sim, updateBill, markPaid, deferBill, deleteBill, addBill, today }) {
  const [expanded, setExpanded] = useState("");
  const rows = useMemo(() => {
    let running = 0;
    return [...state.bills]
      .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"))
      .map((bill) => {
        const simRow = sim.rows.find((row) => row.id === bill.id) || {};
        const impact = bill.accountRule === "offsetContribution" ? Number(bill.amount || 0) : -Number(bill.amount || 0);
        running += impact;
        return { ...bill, ...simRow, runningTotal: running };
      });
  }, [state.bills, sim.rows]);

  const setNumber = (id, key, value) => updateBill(id, { [key]: Math.max(0, Number(value)) });
  const toggleExpanded = (id) => setExpanded(expanded === id ? "" : id);
  const getBillOwner = (bill) => (bill.locked || bill.accountRule === "offset" ? "partnerA" : "partnerB");

  return (
    <section className="page-stack full-bleed-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Master ledger</p>
          <h1>Bills waterfall</h1>
          <p className="section-copy">Kim covers bills in due-date order. Mortgage is locked. Flagged, partial, deferred and unable-to-pay rows stay until resolved.</p>
        </div>
        <button className="primary-action" onClick={addBill}>Quick Add Bill</button>
      </div>

      <div className="inline-note">
        Auto means Kim's external account pays first. Carl's offset is overflow only when SWAN stays protected. Offset contributions are never treated as expenses.
      </div>

      <div className="bill-colour-key" aria-label="Bill colour key">
        <span><i className="partnerA" /> {getPartnerName(state, "A")} / Offset</span>
        <span><i className="partnerB" /> {getPartnerName(state, "B")} / Bills</span>
      </div>

      <div className="bill-readable-list" aria-label="Bill list">
        {rows.map((bill) => {
          const variance = getBillVariance(bill);
          const needsReview = ["flagged", "partial", "unable to pay", "deferred"].includes(bill.simulatedStatus || bill.status);
          const status = bill.simulatedStatus || bill.status;
          const payer = bill.paidBy || (bill.accountRule === "offset" ? getPartnerName(state, "A") : getPartnerName(state, "B"));
          const owner = getBillOwner(bill);
          const isOpen = expanded === bill.id;
          return (
            <article className={`bill-readable-card payer-${owner} ${needsReview ? "needs-review" : ""} ${bill.locked ? "locked-row" : ""}`} key={bill.id}>
              <div className="bill-readable-row" onClick={() => toggleExpanded(bill.id)} role="button" tabIndex={0} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") toggleExpanded(bill.id);
              }}>
                <div className="bill-main">
                  <strong>{bill.name}</strong>
                  <small>{bill.locked ? "Locked mortgage" : bill.category || "Uncategorised"}</small>
                </div>
                <div className="bill-amount">
                  <strong>{currency(bill.amount)}</strong>
                  <small>{bill.accountRule === "offsetContribution" ? "Contribution" : "Bill"}</small>
                </div>
                <div className="bill-due">
                  <span>{shortDate(bill.dueDate)}</span>
                  <small>{payer} / {bill.recurrence}</small>
                </div>
                <StatusBadge status={status} />
                <div className="bill-row-actions" onClick={(event) => event.stopPropagation()}>
                  <button className="mini-action" onClick={() => markPaid(bill.id)}>Paid</button>
                  <button className="mini-action secondary" disabled={bill.locked || bill.dueDate < today} onClick={() => deferBill(bill.id)}>Defer</button>
                  <button className="mini-action secondary" disabled={bill.locked} onClick={() => updateBill(bill.id, { status: "flagged" })}>Flag</button>
                </div>
                <button
                  className="row-toggle"
                  aria-label={isOpen ? "Collapse bill details" : "Expand bill details"}
                  aria-expanded={isOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleExpanded(bill.id);
                  }}
                >
                  {isOpen ? "^" : "v"}
                </button>
              </div>

              {isOpen && (
                <div className="bill-detail-panel">
                  <div className="bill-detail-summary">
                    <div><small>Impact</small><strong className={bill.accountRule === "offsetContribution" ? "positive-cell" : "negative-cell"}>{bill.accountRule === "offsetContribution" ? "+" : "-"}{currency(bill.amount)}</strong></div>
                    <div><small>Running total</small><strong>{currency(bill.runningTotal)}</strong></div>
                    <div><small>Covered by</small><strong>{payer}</strong></div>
                    <div><small>Variance</small><strong className={variance > 20 ? "negative-cell" : variance > 5 ? "warning-cell" : "positive-cell"}>{variance.toFixed(0)}%</strong></div>
                  </div>
                  <div className="bill-edit-grid">
                    <label className="field">
                      <span>Name</span>
                      <input disabled={bill.locked} value={bill.name} onChange={(event) => updateBill(bill.id, { name: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Category</span>
                      <input disabled={bill.locked} value={bill.category} onChange={(event) => updateBill(bill.id, { category: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Amount</span>
                      <input disabled={bill.locked} type="number" value={bill.amount} onChange={(event) => setNumber(bill.id, "amount", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Last amount</span>
                      <input disabled={bill.locked} type="number" value={bill.lastAmount} onChange={(event) => setNumber(bill.id, "lastAmount", event.target.value)} />
                    </label>
                    <label className="field">
                      <span>Due date</span>
                      <input disabled={bill.locked} type="date" value={bill.dueDate} onChange={(event) => updateBill(bill.id, { dueDate: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Frequency</span>
                      <select disabled={bill.locked} value={bill.recurrence} onChange={(event) => updateBill(bill.id, { recurrence: event.target.value })}>
                        {recurrenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Status</span>
                      <select disabled={bill.locked} value={bill.status} onChange={(event) => updateBill(bill.id, { status: event.target.value })}>
                        {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Paid from</span>
                      <select disabled={bill.locked} value={bill.accountRule} onChange={(event) => updateBill(bill.id, { accountRule: event.target.value })}>
                        {accountOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Start date</span>
                      <input disabled={bill.locked} type="date" value={bill.startDate} onChange={(event) => updateBill(bill.id, { startDate: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>End date</span>
                      <input disabled={bill.locked} type="date" value={bill.endDate} onChange={(event) => updateBill(bill.id, { endDate: event.target.value })} />
                    </label>
                  </div>
                  <div className="bill-detail-actions">
                    <button className="mini-action danger" disabled={bill.locked} onClick={() => deleteBill(bill.id)}>Delete bill</button>
                  </div>
                  <div className="audit-box">
                    {(bill.auditLog || []).length === 0 ? <span>No audit entries yet.</span> : bill.auditLog.map((entry, index) => (
                      <p key={`${entry.timestamp}-${index}`}>{entry.timestamp}: {entry.action} ({currency(entry.amount)})</p>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
