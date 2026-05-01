import React, { useMemo, useState } from "react";
import MetricCard from "../components/MetricCard";
import { ProgressBar } from "../components/Charts";
import { addDays, currency, shortDate } from "../logic/financeCalculations";
import { generateWeeklyMoneyCheckIn, getSwanStatus, validateLoan } from "../logic/reporting";
import {
  addVariableLoanTopUp,
  cancelVariableLoanTopUp,
  confirmVariableLoanTopUp,
  getConfirmedLoanTotal,
  getFixedRolloverInfo,
  getFixedRolloverLabel,
  getLoanStatusLabel,
  getLoanTopUpAlerts,
  getMortgageRepaymentAmount,
  getTopUpProjectedImpact,
  getWorkingLoanTotal,
  isBalanceCheckDue,
  reconcileMortgageBalances,
  recordExtraLoanRepayment,
  deleteLoanActivityEvent,
  updateLoanActivityEvent,
} from "../logic/loanLogic";

function Field({ label, helper, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {helper && <small className="helper-text">{helper}</small>}
    </label>
  );
}

function getCheckForm(state) {
  return {
    fixedBalance: Number(state.loan.fixed?.balance || 0),
    fixedRate: Number(state.loan.fixed?.rate || 0),
    fixedEndDate: state.loan.fixed?.fixedEndDate || "",
    variableBalance: Number(state.loan.variable?.balance || 0),
    variableRate: Number(state.loan.variable?.rate || 0),
    singleBalance: Number(state.loan.single?.balance || state.loan.totalBalance || 0),
    offsetBalance: Number(state.accounts.offset.balance || 0),
  };
}

function getTopUpForm(state, today) {
  return {
    expectedDate: addDays(today, 180),
    amount: 0,
    destinationAccount: "offset",
    newVariableRate: state.loan.variable?.rate || "",
    newRepaymentAmount: state.loan.variable?.repaymentAmount || "",
    note: "",
  };
}

function getConfirmTopUpForm(state, topUp) {
  const amount = Number(topUp.amount || 0);
  const destinationAccount = topUp.destinationAccount || "offset";
  return {
    confirmedAmount: amount,
    fundsReceived: amount,
    destinationAccount,
    variableBalance: Number(state.loan.variable?.balance || 0) + amount,
    offsetBalance: destinationAccount === "offset" ? Number(state.accounts.offset?.balance || 0) + amount : Number(state.accounts.offset?.balance || 0),
    externalBalance: destinationAccount === "external" ? Number(state.accounts.externalBalance || 0) + amount : Number(state.accounts.externalBalance || 0),
    newVariableRate: topUp.newVariableRate || state.loan.variable?.rate || "",
    newRepaymentAmount: topUp.newRepaymentAmount || state.loan.variable?.repaymentAmount || "",
  };
}

function getExtraRepaymentForm(state, today) {
  return {
    date: today,
    amount: 0,
    fromAccount: "offset",
    targetSplit: state.loan.mode === "split" ? "variable" : "single",
    bankConfirmed: true,
    note: "",
  };
}

export default function LoanDetails({ state, setState, loanMetrics, today }) {
  const warnings = useMemo(() => validateLoan(state), [state]);
  const weeklyEmail = useMemo(() => generateWeeklyMoneyCheckIn(state, today), [state, today]);
  const [form, setForm] = useState(() => getCheckForm(state));
  const [message, setMessage] = useState("");
  const [topUpForm, setTopUpForm] = useState(() => getTopUpForm(state, today));
  const [topUpMessage, setTopUpMessage] = useState("");
  const [confirmingTopUpId, setConfirmingTopUpId] = useState("");
  const [confirmTopUpForm, setConfirmTopUpForm] = useState(null);
  const [extraRepaymentForm, setExtraRepaymentForm] = useState(() => getExtraRepaymentForm(state, today));
  const [extraRepaymentMessage, setExtraRepaymentMessage] = useState("");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState("");
  const [activityForm, setActivityForm] = useState(null);
  const [activityMessage, setActivityMessage] = useState("");
  const swan = getSwanStatus(state);
  const total = loanMetrics.totalBalance || 1;
  const fixedPct = state.loan.mode === "split" ? (Number(state.loan.fixed.balance || 0) / total) * 100 : 0;
  const checkDue = isBalanceCheckDue(state, today);
  const workingTotal = getWorkingLoanTotal(state.loan);
  const confirmedTotal = getConfirmedLoanTotal(state.loan);
  const statusLabel = getLoanStatusLabel(state.loan.balanceStatus);
  const fixedRollover = getFixedRolloverInfo(state.loan, today);
  const plannedTopUps = (state.loan.topUps || []).filter((topUp) => topUp.status === "planned");
  const recentTopUps = (state.loan.topUps || []).filter((topUp) => topUp.status !== "planned").slice(0, 3);
  const topUpAlerts = getLoanTopUpAlerts(state, today);
  const currentRepayment = getMortgageRepaymentAmount(state.loan);
  const fullActivity = state.loan.activity || [];
  const recentActivity = showAllActivity ? fullActivity : fullActivity.slice(0, 10);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: Math.max(0, Number(value)) }));
  };

  const updateFormText = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateTopUpForm = (key, value) => {
    setTopUpForm((current) => ({ ...current, [key]: key === "amount" ? Math.max(0, Number(value)) : value }));
  };

  const updateConfirmTopUpForm = (key, value) => {
    setConfirmTopUpForm((current) => ({
      ...current,
      [key]: ["confirmedAmount", "fundsReceived", "variableBalance", "offsetBalance", "externalBalance", "newVariableRate", "newRepaymentAmount"].includes(key)
        ? Math.max(0, Number(value))
        : value,
    }));
  };

  const updateExtraRepaymentForm = (key, value) => {
    setExtraRepaymentForm((current) => ({
      ...current,
      [key]: key === "amount" ? Math.max(0, Number(value)) : key === "bankConfirmed" ? Boolean(value) : value,
    }));
  };

  const saveExtraRepayment = () => {
    if (Number(extraRepaymentForm.amount || 0) <= 0) {
      setExtraRepaymentMessage("Enter an extra repayment amount first.");
      return;
    }
    setState((current) => recordExtraLoanRepayment(current, extraRepaymentForm, today), { type: "extra_repayment_recorded", title: "Extra loan repayment recorded", amount: extraRepaymentForm.amount, source: "loan" });
    setExtraRepaymentMessage("Extra repayment recorded. It reduced the selected loan balance and moved money out of the selected account.");
    setExtraRepaymentForm(getExtraRepaymentForm(state, today));
  };

  const saveTopUpPlan = () => {
    setState((current) => addVariableLoanTopUp(current, topUpForm, today), { type: "loan_topup_planned", title: "Variable top-up planned", amount: topUpForm.amount, source: "loan" });
    setTopUpMessage("Variable top-up planned for forecasting. It is borrowed money, not income.");
    setTopUpForm(getTopUpForm(state, today));
  };

  const startConfirmTopUp = (topUp) => {
    setConfirmingTopUpId(topUp.id);
    setConfirmTopUpForm(getConfirmTopUpForm(state, topUp));
    setTopUpMessage("");
  };

  const saveTopUpConfirmation = () => {
    if (!confirmingTopUpId || !confirmTopUpForm) return;
    setState((current) => confirmVariableLoanTopUp(current, confirmingTopUpId, confirmTopUpForm, today), { type: "loan_topup_confirmed", title: "Variable top-up confirmed", amount: confirmTopUpForm.confirmedAmount, source: "loan" });
    setTopUpMessage("Top-up confirmed. Variable loan and the destination account have been updated from bank-confirmed amounts.");
    setConfirmingTopUpId("");
    setConfirmTopUpForm(null);
  };

  const cancelTopUp = (topUpId) => {
    setState((current) => cancelVariableLoanTopUp(current, topUpId, today), { type: "loan_topup_cancelled", title: "Variable top-up cancelled", source: "loan" });
    setTopUpMessage("Planned top-up cancelled. No balances were changed.");
    if (confirmingTopUpId === topUpId) {
      setConfirmingTopUpId("");
      setConfirmTopUpForm(null);
    }
  };

  const saveCheck = (values) => {
    setState((current) => reconcileMortgageBalances(current, values, today), { type: "loan_balance_checked", title: "Loan and offset balances checked", source: "loan" });
    setForm({ ...values });
    setMessage("Balances confirmed. The estimate has been reset to the bank numbers.");
  };

  const confirmAll = () => saveCheck(getCheckForm(state));
  const saveUpdated = () => saveCheck(form);
  const resetForm = () => {
    setForm(getCheckForm(state));
    setMessage("");
  };

  const startEditActivity = (event) => {
    setEditingActivityId(event.id);
    setActivityForm({
      date: event.date || today,
      title: event.title || "Loan activity",
      detail: event.detail || "",
      amount: event.amount === "" ? "" : Number(event.amount || 0),
    });
    setActivityMessage("");
  };

  const saveActivityEdit = () => {
    if (!editingActivityId || !activityForm) return;
    setState((current) => updateLoanActivityEvent(current, editingActivityId, activityForm, today), { type: "loan_activity_edited", title: "Mortgage activity edited", entityType: "loan_activity", entityId: editingActivityId });
    setActivityMessage("Activity updated. Extra repayment amount edits also adjust the related balances.");
    setEditingActivityId("");
    setActivityForm(null);
  };

  const deleteActivity = (event) => {
    setState((current) => deleteLoanActivityEvent(current, event.id, today), { type: "loan_activity_deleted", title: "Mortgage activity deleted", entityType: "loan_activity", entityId: event.id });
    setActivityMessage(event.type === "extra_repayment" && event.impact ? "Extra repayment activity deleted and balances reversed." : "Activity note deleted. Use balance check to correct bank balances if needed.");
    if (editingActivityId === event.id) {
      setEditingActivityId("");
      setActivityForm(null);
    }
  };

  return (
    <section className="page-stack full-bleed-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Loan and offset</p>
          <h1>{state.loan.mode === "split" ? "Split loan interest engine" : "Single loan interest engine"}</h1>
          <p className="section-copy">Estimated between repayments. Bank-confirmed balances stay as the source of truth.</p>
        </div>
        <span className={`pill ${checkDue ? "warning" : warnings.length ? "warning" : "safe"}`}>
          {checkDue ? "Balance check due" : warnings.length ? "Review settings" : statusLabel}
        </span>
      </div>

      {warnings.length > 0 && <div className="inline-warning">{warnings.join(" ")}</div>}
      {state.loan.lastEstimate?.underpayingInterest && <div className="inline-warning">Last repayment did not cover the estimated interest. Check the repayment split or rate.</div>}
      {fixedRollover.warning && <div className="inline-warning">{fixedRollover.message}</div>}
      {state.loan.lastRolloverMessage && <div className="inline-warning">{state.loan.lastRolloverMessage}</div>}
      {topUpAlerts.length > 0 && <div className="inline-warning">{topUpAlerts[0].message} This changes debt and cash, not income.</div>}

      <div className="metrics-grid">
        <MetricCard label="Working mortgage balance" value={workingTotal} tone={state.loan.balanceStatus === "confirmed" ? "safe" : "warning"} />
        <MetricCard label="Bank-confirmed balance" value={confirmedTotal} />
        <MetricCard label="Offset balance" value={state.accounts.offset.balance} tone={state.accounts.offset.balanceStatus === "confirmed" ? "safe" : "warning"} />
        <MetricCard label="Daily net interest" value={loanMetrics.dailyNetInterest} />
        <MetricCard label="Monthly projected interest" value={loanMetrics.monthlyInterest} />
        <MetricCard label="Mortgage repayment" value={currentRepayment} />
        {state.loan.mode === "split" && <MetricCard label="Fixed rate ends" value={state.loan.fixed.fixedEndDate || "Not set"} detail={getFixedRolloverLabel(fixedRollover)} tone={fixedRollover.warning ? "warning" : "safe"} money={false} />}
      </div>

      <div className="two-column">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Loan split</h2>
              <p className="helper-text">{state.loan.balanceStatus === "confirmed" ? "Bank-confirmed" : "Estimated"} · Last checked {state.loan.lastConfirmedDate || "not yet"}</p>
            </div>
            <span>{currency(loanMetrics.totalBalance)}</span>
          </div>
          {state.loan.mode === "split" ? (
            <>
              <div className="loan-split-bar">
                <i style={{ width: `${fixedPct}%` }} />
              </div>
              <div className="split-loans">
                <div>
                  <small>Fixed split · {state.loan.fixed.status || getLoanStatusLabel(state.loan.balanceStatus)}</small>
                  <strong>{currency(state.loan.fixed.balance)}</strong>
                  <span>{state.loan.fixed.rate}% · confirmed {currency(state.loan.fixed.confirmedBalance)}</span>
                  <small>Fixed until: {state.loan.fixed.fixedEndDate || "not set"} · {getFixedRolloverLabel(fixedRollover)}</small>
                  <small>Repayment share: {state.loan.fixed.repaymentAmount ? currency(state.loan.fixed.repaymentAmount) : "proportional estimate"}</small>
                </div>
                <div>
                  <small>Variable split with offset · {getLoanStatusLabel(state.loan.balanceStatus)}</small>
                  <strong>{currency(state.loan.variable.balance)}</strong>
                  <span>{state.loan.variable.rate}% · confirmed {currency(state.loan.variable.confirmedBalance)}</span>
                  <small>Repayment share: {state.loan.variable.repaymentAmount ? currency(state.loan.variable.repaymentAmount) : "proportional estimate"}</small>
                </div>
              </div>
            </>
          ) : (
            <div className="split-loans">
              <div>
                <small>Single loan with offset · {getLoanStatusLabel(state.loan.balanceStatus)}</small>
                <strong>{currency(state.loan.single.balance)}</strong>
                <span>{state.loan.single.rate}% · confirmed {currency(state.loan.single.confirmedBalance)}</span>
              </div>
            </div>
          )}
          {state.loan.lastEstimate && (
            <div className="simulation-note">
              <strong>Last repayment estimate</strong>
              <p>
                Principal {currency(state.loan.lastEstimate.estimatedPrincipal)} · interest {currency(state.loan.lastEstimate.estimatedInterest)} · {state.loan.lastEstimate.allocationMode}
              </p>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Comfort checks</h2>
              <p className="helper-text">Next balance check: {state.loan.nextReconciliationDate || "not set"}</p>
            </div>
            <span>{swan.label}</span>
          </div>
          <ProgressBar label="SWAN floor" value={swan.progress} detail={`${currency(state.accounts.offset.balance)} of ${currency(state.accounts.offset.swanFloor)}`} tone={swan.tone} />
          <ProgressBar label="Mortgage payoff progress" value={Math.max(1, 100 - (loanMetrics.totalBalance / 900000) * 100)} detail={`${currency(loanMetrics.totalBalance)} remaining`} tone="safe" />
          {checkDue && <div className="inline-warning">Quick balance check due. Confirm your fixed, variable and offset balances from your bank when you get a minute.</div>}
        </article>
      </div>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Check loan & offset balances</h2>
            <p className="helper-text">One weekly/fortnightly check keeps the split-loan estimate honest without daily admin.</p>
          </div>
          <span className={`pill ${checkDue ? "warning" : "safe"}`}>{checkDue ? "Due" : "Scheduled"}</span>
        </div>
        <div className="form-grid">
          {state.loan.mode === "split" ? (
            <>
              <Field label="Fixed split bank balance" helper={`Current estimate ${currency(state.loan.fixed.balance)}`}>
                <input type="number" value={form.fixedBalance} onChange={(event) => updateForm("fixedBalance", event.target.value)} />
              </Field>
              <Field label="Fixed rate" helper="Update this if the bank changes the fixed rate before rollover.">
                <input type="number" step="0.01" value={form.fixedRate} onChange={(event) => updateForm("fixedRate", event.target.value)} />
              </Field>
              <Field label="Fixed rate end date" helper="When this date arrives, the fixed balance rolls into variable.">
                <input type="date" value={form.fixedEndDate} onChange={(event) => updateFormText("fixedEndDate", event.target.value)} />
              </Field>
              <Field label="Variable split bank balance" helper={`Current estimate ${currency(state.loan.variable.balance)}`}>
                <input type="number" value={form.variableBalance} onChange={(event) => updateForm("variableBalance", event.target.value)} />
              </Field>
              <Field label="Variable rate" helper="After fixed rollover, confirm the new variable rate here.">
                <input type="number" step="0.01" value={form.variableRate} onChange={(event) => updateForm("variableRate", event.target.value)} />
              </Field>
            </>
          ) : (
            <Field label="Loan bank balance" helper={`Current estimate ${currency(state.loan.single.balance)}`}>
              <input type="number" value={form.singleBalance} onChange={(event) => updateForm("singleBalance", event.target.value)} />
            </Field>
          )}
          <Field label="Offset bank balance" helper={`Current estimate ${currency(state.accounts.offset.balance)}`}>
            <input type="number" value={form.offsetBalance} onChange={(event) => updateForm("offsetBalance", event.target.value)} />
          </Field>
        </div>
        <div className="preset-row">
          <button onClick={confirmAll}>Looks right — confirm all</button>
          <button onClick={saveUpdated}>Save updated balances</button>
          <button onClick={resetForm}>Reset fields</button>
        </div>
        {message && <p className="helper-text">{message}</p>}
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Record extra repayment</h2>
            <p className="helper-text">Use this for lump-sum or extra payments. It is not a bill and it is not income.</p>
          </div>
          <span className="pill">Principal reduction</span>
        </div>
        <div className="form-grid">
          <Field label="Payment date">
            <input type="date" value={extraRepaymentForm.date} onChange={(event) => updateExtraRepaymentForm("date", event.target.value)} />
          </Field>
          <Field label="Extra repayment amount">
            <input type="number" value={extraRepaymentForm.amount} onChange={(event) => updateExtraRepaymentForm("amount", event.target.value)} />
          </Field>
          <Field label="From account">
            <select value={extraRepaymentForm.fromAccount} onChange={(event) => updateExtraRepaymentForm("fromAccount", event.target.value)}>
              <option value="offset">Offset</option>
              <option value="external">Bills account</option>
              <option value="other">Other / not tracked</option>
            </select>
          </Field>
          <Field label="Apply to">
            <select value={extraRepaymentForm.targetSplit} onChange={(event) => updateExtraRepaymentForm("targetSplit", event.target.value)}>
              {state.loan.mode === "split" ? (
                <>
                  <option value="variable">Variable loan</option>
                  <option value="fixed">Fixed loan</option>
                  <option value="split">Split proportionally</option>
                </>
              ) : (
                <option value="single">Single loan</option>
              )}
            </select>
          </Field>
          <Field label="Note">
            <input value={extraRepaymentForm.note} onChange={(event) => updateExtraRepaymentForm("note", event.target.value)} placeholder="Bonus, lump sum, refund, other" />
          </Field>
          <label className="field checkbox-field">
            <span>Bank confirmed</span>
            <input type="checkbox" checked={extraRepaymentForm.bankConfirmed} onChange={(event) => updateExtraRepaymentForm("bankConfirmed", event.target.checked)} />
            <small className="helper-text">Tick this when the payment and new balance are visible in the bank app.</small>
          </label>
        </div>
        {extraRepaymentForm.targetSplit === "fixed" && (
          <div className="inline-warning">Fixed loans can have extra repayment limits or fees. Check your lender rules before paying extra into the fixed split.</div>
        )}
        <div className="preset-row">
          <button onClick={saveExtraRepayment}>Record extra repayment</button>
        </div>
        {extraRepaymentMessage && <p className="helper-text">{extraRepaymentMessage}</p>}
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Planned variable top-up</h2>
            <p className="helper-text">Plan a 6–12 month top-up for forecasting, then confirm it from the bank when it actually happens.</p>
          </div>
          <span className="pill">Borrowed funds</span>
        </div>
        <div className="simulation-note">
          <strong>Important</strong>
          <p>A top-up increases the variable loan balance. If funds land in offset or the bills account, that account increases too. It is not counted as income.</p>
        </div>
        <div className="form-grid">
          <Field label="Expected top-up date">
            <input type="date" value={topUpForm.expectedDate} onChange={(event) => updateTopUpForm("expectedDate", event.target.value)} />
          </Field>
          <Field label="Top-up amount">
            <input type="number" value={topUpForm.amount} onChange={(event) => updateTopUpForm("amount", event.target.value)} />
          </Field>
          <Field label="Funds land in">
            <select value={topUpForm.destinationAccount} onChange={(event) => updateTopUpForm("destinationAccount", event.target.value)}>
              <option value="offset">Offset</option>
              <option value="external">Bills account</option>
            </select>
          </Field>
          <Field label="Expected variable rate" helper="Optional. Leave as current rate until the bank confirms.">
            <input type="number" step="0.01" value={topUpForm.newVariableRate} onChange={(event) => updateTopUpForm("newVariableRate", event.target.value)} />
          </Field>
          <Field label="Expected variable repayment" helper="Optional. Update after bank approval if unknown.">
            <input type="number" value={topUpForm.newRepaymentAmount} onChange={(event) => updateTopUpForm("newRepaymentAmount", event.target.value)} />
          </Field>
          <Field label="Note">
            <input value={topUpForm.note} onChange={(event) => updateTopUpForm("note", event.target.value)} placeholder="Renovation, buffer, car, other" />
          </Field>
        </div>
        <div className="preset-row">
          <button onClick={saveTopUpPlan}>Add variable loan top-up</button>
        </div>
        {topUpMessage && <p className="helper-text">{topUpMessage}</p>}

        <div className="item-list spacious-list">
          {plannedTopUps.length ? plannedTopUps.map((topUp) => {
            const impact = getTopUpProjectedImpact(state, topUp);
            const isConfirming = confirmingTopUpId === topUp.id;
            return (
              <div className="ledger-row topup-row" key={topUp.id}>
                <div>
                  <strong>{currency(topUp.amount)} planned variable top-up</strong>
                  <small>{shortDate(topUp.expectedDate)} · funds to {topUp.destinationAccount === "offset" ? "offset" : "bills account"} · {topUp.note || "No note"}</small>
                  <small>Forecast after top-up: variable {currency(impact.plannedVariableBalance)} · offset {currency(impact.plannedOffsetBalance)}</small>
                  {isConfirming && confirmTopUpForm && (
                    <div className="nested-form">
                      <div className="form-grid">
                        <Field label="Confirmed top-up amount">
                          <input type="number" value={confirmTopUpForm.confirmedAmount} onChange={(event) => updateConfirmTopUpForm("confirmedAmount", event.target.value)} />
                        </Field>
                        <Field label="Funds received">
                          <input type="number" value={confirmTopUpForm.fundsReceived} onChange={(event) => updateConfirmTopUpForm("fundsReceived", event.target.value)} />
                        </Field>
                        <Field label="Variable loan balance shown by bank">
                          <input type="number" value={confirmTopUpForm.variableBalance} onChange={(event) => updateConfirmTopUpForm("variableBalance", event.target.value)} />
                        </Field>
                        <Field label="Destination account">
                          <select value={confirmTopUpForm.destinationAccount} onChange={(event) => updateConfirmTopUpForm("destinationAccount", event.target.value)}>
                            <option value="offset">Offset</option>
                            <option value="external">Bills account</option>
                          </select>
                        </Field>
                        {confirmTopUpForm.destinationAccount === "offset" ? (
                          <Field label="Offset balance shown by bank">
                            <input type="number" value={confirmTopUpForm.offsetBalance} onChange={(event) => updateConfirmTopUpForm("offsetBalance", event.target.value)} />
                          </Field>
                        ) : (
                          <Field label="Bills account balance shown by bank">
                            <input type="number" value={confirmTopUpForm.externalBalance} onChange={(event) => updateConfirmTopUpForm("externalBalance", event.target.value)} />
                          </Field>
                        )}
                        <Field label="New variable rate">
                          <input type="number" step="0.01" value={confirmTopUpForm.newVariableRate} onChange={(event) => updateConfirmTopUpForm("newVariableRate", event.target.value)} />
                        </Field>
                        <Field label="New variable repayment">
                          <input type="number" value={confirmTopUpForm.newRepaymentAmount} onChange={(event) => updateConfirmTopUpForm("newRepaymentAmount", event.target.value)} />
                        </Field>
                      </div>
                      <div className="preset-row">
                        <button onClick={saveTopUpConfirmation}>Confirm top-up</button>
                        <button onClick={() => { setConfirmingTopUpId(""); setConfirmTopUpForm(null); }}>Close</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <button onClick={() => startConfirmTopUp(topUp)}>Confirm</button>
                  <button onClick={() => cancelTopUp(topUp.id)}>Cancel</button>
                </div>
              </div>
            );
          }) : <p className="empty-text">No planned variable top-ups yet.</p>}
        </div>

        {recentTopUps.length > 0 && (
          <div className="item-list">
            <h2>Recent top-up decisions</h2>
            {recentTopUps.map((topUp) => (
              <div className="ledger-row" key={topUp.id}>
                <div>
                  <strong>{currency(topUp.confirmedAmount || topUp.amount)} · {topUp.status}</strong>
                  <small>{topUp.confirmedDate || topUp.cancelledDate || topUp.expectedDate} · {topUp.destinationAccount}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Mortgage activity</h2>
            <p className="helper-text">Saved history for balance checks, top-ups, extra repayments and rollover events. Extra repayment edits can reverse or correct balances.</p>
          </div>
          <div className="header-actions">
            <span className="pill">{fullActivity.length} saved</span>
            <button onClick={() => setShowAllActivity((current) => !current)}>{showAllActivity ? "Show recent" : "Show all"}</button>
          </div>
        </div>
        {activityMessage && <div className="inline-note">{activityMessage}</div>}
        <div className="item-list spacious-list">
          {recentActivity.length ? recentActivity.map((event) => {
            const isEditing = editingActivityId === event.id;
            return (
              <div className="ledger-row" key={event.id}>
                <div>
                  {isEditing && activityForm ? (
                    <div className="nested-form">
                      <div className="form-grid">
                        <Field label="Date"><input type="date" value={activityForm.date} onChange={(e) => setActivityForm((current) => ({ ...current, date: e.target.value }))} /></Field>
                        <Field label="Title"><input value={activityForm.title} onChange={(e) => setActivityForm((current) => ({ ...current, title: e.target.value }))} /></Field>
                        <Field label="Amount"><input type="number" value={activityForm.amount} onChange={(e) => setActivityForm((current) => ({ ...current, amount: Math.max(0, Number(e.target.value || 0)) }))} /></Field>
                        <Field label="Detail"><input value={activityForm.detail} onChange={(e) => setActivityForm((current) => ({ ...current, detail: e.target.value }))} /></Field>
                      </div>
                      {event.type !== "extra_repayment" && <small className="helper-text">Editing this changes the history note only. Use balance check to correct bank numbers.</small>}
                      <div className="preset-row">
                        <button onClick={saveActivityEdit}>Save activity</button>
                        <button onClick={() => { setEditingActivityId(""); setActivityForm(null); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <strong>{event.title}</strong>
                      <small>{shortDate(event.date)} · {event.confirmed ? "bank-confirmed" : "estimated"}{event.reversible ? " · reversible" : ""}{event.detail ? " · " + event.detail : ""}</small>
                    </>
                  )}
                </div>
                <div className="row-actions">
                  {event.amount !== "" && <span>{currency(event.amount)}</span>}
                  <button onClick={() => startEditActivity(event)}>Edit</button>
                  <button className="danger-button" onClick={() => deleteActivity(event)}>Delete</button>
                </div>
              </div>
            );
          }) : <p className="empty-text">No mortgage activity recorded yet.</p>}
        </div>
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Monday email preview</h2>
            <p className="helper-text">Frontend preview only. This is the summary a backend email provider can send later.</p>
          </div>
          <span className="pill">{weeklyEmail.title}</span>
        </div>
        <div className="email-preview">
          <h2>{weeklyEmail.intro}</h2>
          <div className="split-loans">
            <div><small>Bills account</small><strong>{currency(weeklyEmail.accountSummary.externalBalance)}</strong></div>
            <div><small>Offset · {weeklyEmail.accountSummary.offsetStatus}</small><strong>{currency(weeklyEmail.accountSummary.offsetBalance)}</strong></div>
            <div><small>Mortgage · {weeklyEmail.accountSummary.loanStatus}</small><strong>{currency(weeklyEmail.accountSummary.totalMortgageBalance)}</strong></div>
            <div><small>Fixed ends · {weeklyEmail.accountSummary.fixedStatus}</small><strong>{weeklyEmail.accountSummary.fixedEndDate || "Not set"}</strong></div>
          </div>
          <div className="item-list">
            <div className="alert-row"><strong>Alerts</strong><span>{weeklyEmail.alerts.join(" ")}</span></div>
            <div className="alert-row"><strong>Outlook</strong><span>Projected week net {currency(weeklyEmail.outlook.weeklyNet)} · offset ends near {currency(weeklyEmail.outlook.projectedOffset)}</span></div>
            <div className="alert-row"><strong>Mortgage check</strong><span>{weeklyEmail.mortgageCheck.due ? "Fixed, variable and offset balances are ready to confirm." : `Next check ${weeklyEmail.mortgageCheck.nextCheckDate}`}</span></div>
            <div className="alert-row"><strong>Fixed rollover</strong><span>{weeklyEmail.mortgageCheck.fixedRollover?.message || "No fixed-rate alert."}</span></div>
            <div className="alert-row"><strong>Loan top-up</strong><span>{weeklyEmail.mortgageCheck.topUps?.length ? weeklyEmail.mortgageCheck.topUps[0].message : "No planned top-up alert."}</span></div>
          </div>
          <h2>Suggested actions</h2>
          <div className="item-list">
            {weeklyEmail.actions.map((action) => <div className="ledger-row" key={action}><span>{action}</span></div>)}
          </div>
          <h2>Bills due this week</h2>
          <div className="item-list">
            {weeklyEmail.billsDue.length ? weeklyEmail.billsDue.map((bill) => (
              <div className="ledger-row" key={`${bill.id}-${bill.dueDate}`}>
                <div><strong>{bill.name}</strong><small>{shortDate(bill.dueDate)} · {bill.accountRule}</small></div>
                <span>{currency(bill.amount)}</span>
              </div>
            )) : <p className="empty-text">No bills due this week.</p>}
          </div>
        </div>
      </article>
    </section>
  );
}
