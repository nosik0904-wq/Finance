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

      <div className="mobile-bill-list" aria-label="Mobile bill list">
        {rows.map((bill) => {
          const variance = getBillVariance(bill);
          const needsReview = ["flagged", "partial", "unable to pay", "deferred"].includes(bill.simulatedStatus || bill.status);
          return (
            <article className={`mobile-bill-card ${needsReview ? "needs-review" : ""} ${bill.locked ? "locked-row" : ""}`} key={`mobile-${bill.id}`}>
              <div className="mobile-bill-head">
                <div>
                  <input
                    className="mobile-bill-name"
                    disabled={bill.locked}
                    value={bill.name}
                    onChange={(event) => updateBill(bill.id, { name: event.target.value })}
                  />
                  <small>{bill.locked ? "Locked mortgage" : bill.category || "Uncategorised"}</small>
                </div>
                <div className="row-end">
                  <strong>{currency(bill.amount)}</strong>
                  <StatusBadge status={bill.simulatedStatus || bill.status} />
                </div>
              </div>

              <div className="mobile-bill-meta">
                <span>Due {shortDate(bill.dueDate)}</span>
                <span>{bill.recurrence}</span>
                <span className={variance > 20 ? "negative-cell" : variance > 5 ? "warning-cell" : "positive-cell"}>{variance.toFixed(0)}% variance</span>
              </div>

              <div className="mobile-bill-edit-grid">
                <label className="field">
                  <span>Amount</span>
                  <input disabled={bill.locked} type="number" value={bill.amount} onChange={(event) => setNumber(bill.id, "amount", event.target.value)} />
                </label>
                <label className="field">
                  <span>Due date</span>
                  <input disabled={bill.locked} type="date" value={bill.dueDate} onChange={(event) => updateBill(bill.id, { dueDate: event.target.value })} />
                </label>
              </div>

              {expanded === bill.id && (
                <div className="mobile-bill-more">
                  <div className="mobile-bill-edit-grid">
                    <label className="field">
                      <span>Category</span>
                      <input disabled={bill.locked} value={bill.category} onChange={(event) => updateBill(bill.id, { category: event.target.value })} />
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
                        {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Paid from</span>
                      <select disabled={bill.locked} value={bill.accountRule} onChange={(event) => updateBill(bill.id, { accountRule: event.target.value })}>
                        {accountOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="audit-box">
                    {(bill.auditLog || []).length === 0 ? <span>No audit entries yet.</span> : bill.auditLog.slice(0, 3).map((entry, index) => (
                      <p key={`${entry.timestamp}-${index}`}>{entry.timestamp}: {entry.action} ({currency(entry.amount)})</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="bill-actions mobile-card-actions">
                <button onClick={() => markPaid(bill.id)}>Mark paid</button>
                <button className="mini-action secondary" disabled={bill.locked || bill.dueDate < today} onClick={() => deferBill(bill.id)}>Defer</button>
                <button className="mini-action secondary" onClick={() => setExpanded(expanded === bill.id ? "" : bill.id)}>{expanded === bill.id ? "Less" : "More"}</button>
                <button className="mini-action danger" disabled={bill.locked} onClick={() => deleteBill(bill.id)}>Delete</button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="bill-ledger-wrap">

        <table className="bill-ledger">
          <thead>
            <tr>
              <th>Bill Name</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Last</th>
              <th>Variance</th>
              <th>Freq</th>
              <th>Start Date</th>
              <th>End Date</th>
              <th>Status</th>
              <th>Next Due</th>
              <th>Impact</th>
              <th>Running Total</th>
              <th>Covered By</th>
              <th>Fixed To</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((bill) => {
              const variance = getBillVariance(bill);
              const needsReview = ["flagged", "partial", "unable to pay", "deferred"].includes(bill.simulatedStatus || bill.status);
              return (
                <React.Fragment key={bill.id}>
                  <tr className={`${needsReview ? "needs-review" : ""} ${bill.locked ? "locked-row" : ""}`}>
                    <td>
                      <input disabled={bill.locked} value={bill.name} onChange={(event) => updateBill(bill.id, { name: event.target.value })} />
                      {bill.locked && <small>Locked mortgage</small>}
                    </td>
                    <td><input disabled={bill.locked} value={bill.category} onChange={(event) => updateBill(bill.id, { category: event.target.value })} /></td>
                    <td><input disabled={bill.locked} type="number" value={bill.amount} onChange={(event) => setNumber(bill.id, "amount", event.target.value)} /></td>
                    <td><input disabled={bill.locked} type="number" value={bill.lastAmount} onChange={(event) => setNumber(bill.id, "lastAmount", event.target.value)} /></td>
                    <td className={variance > 20 ? "negative-cell" : variance > 5 ? "warning-cell" : "positive-cell"}>{variance.toFixed(0)}%</td>
                    <td>
                      <select disabled={bill.locked} value={bill.recurrence} onChange={(event) => updateBill(bill.id, { recurrence: event.target.value })}>
                        {recurrenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </td>
                    <td><input disabled={bill.locked} type="date" value={bill.startDate} onChange={(event) => updateBill(bill.id, { startDate: event.target.value })} /></td>
                    <td><input disabled={bill.locked} type="date" value={bill.endDate} onChange={(event) => updateBill(bill.id, { endDate: event.target.value })} /></td>
                    <td>
                      <select disabled={bill.locked} value={bill.status} onChange={(event) => updateBill(bill.id, { status: event.target.value })}>
                        {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                    <td>
                      <input disabled={bill.locked} type="date" value={bill.dueDate} onChange={(event) => updateBill(bill.id, { dueDate: event.target.value })} />
                      {bill.dueDate && <small>{shortDate(bill.dueDate)}</small>}
                    </td>
                    <td className={bill.accountRule === "offsetContribution" ? "positive-cell" : "negative-cell"}>
                      {bill.accountRule === "offsetContribution" ? "+" : "-"}{currency(bill.amount)}
                    </td>
                    <td>{currency(bill.runningTotal)}</td>
                    <td>
                      <strong>{bill.paidBy || (bill.accountRule === "offset" ? getPartnerName(state, "A") : getPartnerName(state, "B"))}</strong>
                      <small>{bill.note || "Forecast pending"}</small>
                    </td>
                    <td>
                      <select disabled={bill.locked} value={bill.accountRule} onChange={(event) => updateBill(bill.id, { accountRule: event.target.value })}>
                        {accountOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </td>
                    <td>
                      <button className="mini-action" onClick={() => markPaid(bill.id)}>Mark paid</button>
                      <button className="mini-action secondary" disabled={bill.locked || bill.dueDate < today} onClick={() => deferBill(bill.id)}>Defer</button>
                      <button className="mini-action secondary" onClick={() => setExpanded(expanded === bill.id ? "" : bill.id)}>Audit</button>
                      <button className="mini-action danger" disabled={bill.locked} onClick={() => deleteBill(bill.id)}>Delete</button>
                      <StatusBadge status={bill.simulatedStatus || bill.status} />
                    </td>
                  </tr>
                  {expanded === bill.id && (
                    <tr>
                      <td colSpan="15">
                        <div className="audit-box">
                          {(bill.auditLog || []).length === 0 ? <span>No audit entries yet.</span> : bill.auditLog.map((entry, index) => (
                            <p key={`${entry.timestamp}-${index}`}>{entry.timestamp}: {entry.action} ({currency(entry.amount)})</p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
