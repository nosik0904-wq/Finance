import React, { useMemo, useState } from "react";
import CloudSyncPanel from "../components/CloudSyncPanel";
import MetricCard from "../components/MetricCard";
import { ProgressBar } from "../components/Charts";
import { addMonthsClamped, currency, daysBetween } from "../logic/financeCalculations";
import { getGoLiveChecklist, getIncome, getPartnerName } from "../logic/engine";
import { getSwanStatus, validateLoan } from "../logic/reporting";
import { exportActionLogCsv, exportBalanceSnapshotsCsv, exportDebugBundle, exportFullArchiveCsv, exportMortgageActivityCsv } from "../logic/auditTrail";

const steps = ["Household", "Income", "Bill Rules", "Loan", "Safety", "Review"];

function Field({ label, helper, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {helper && <small className="helper-text">{helper}</small>}
    </label>
  );
}

export default function Setup({ state, setState, sim, clearAllData, onComplete, cloudSync }) {
  const [step, setStep] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [importText, setImportText] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const incomeA = getIncome(state, "A");
  const incomeB = getIncome(state, "B");
  const swan = getSwanStatus(state);
  const loanWarnings = useMemo(() => validateLoan(state), [state]);
  const checklist = useMemo(() => getGoLiveChecklist(state), [state]);
  const paydayGap = Math.abs(daysBetween(incomeA.nextPaydate, incomeB.nextPaydate));
  const staggerWarning = paydayGap < 6 || paydayGap > 8;

  const patch = (path, value) => {
    setState((current) => {
      const next = structuredClone(current);
      let target = next;
      path.slice(0, -1).forEach((key) => {
        target = target[key];
      });
      target[path[path.length - 1]] = value;
      return next;
    });
  };

  const patchIncome = (partner, key, value) => {
    setState((current) => ({
      ...current,
      income: current.income.map((income) => (income.partner === partner ? { ...income, [key]: value } : income)),
    }));
  };

  const n = (value) => Math.max(0, Number(value));
  const updateSplitTotal = (value) => {
    const total = n(value);
    setState((current) => {
      const fixed = Number(current.loan.fixed.balance || 0);
      return {
        ...current,
        loan: {
          ...current.loan,
          totalBalance: total,
          variable: {
            ...current.loan.variable,
            balance: Math.max(0, total - fixed),
          },
        },
      };
    });
  };

  const updateFixedTermYears = (value) => {
    const fixedTermYears = Number(value);
    setState((current) => {
      const fixedStartDate = current.loan.fixed.fixedStartDate || current.loan.lastConfirmedDate || "2026-04-29";
      const fixedEndDate = fixedTermYears > 0 ? addMonthsClamped(fixedStartDate, fixedTermYears * 12) : current.loan.fixed.fixedEndDate;
      return {
        ...current,
        loan: {
          ...current.loan,
          fixed: {
            ...current.loan.fixed,
            fixedStartDate,
            fixedTermYears,
            fixedEndDate,
            status: current.loan.fixed.status === "rolled_to_variable" ? "rolled_to_variable" : "active",
          },
          fixedRollover: {
            ...(current.loan.fixedRollover || {}),
            enabled: true,
            rolloverDate: fixedEndDate,
            rolloverBehaviour: "merge_into_variable",
          },
        },
      };
    });
  };

  const updateFixedEndDate = (value) => {
    setState((current) => ({
      ...current,
      loan: {
        ...current.loan,
        fixed: {
          ...current.loan.fixed,
          fixedEndDate: value,
          status: current.loan.fixed.status === "rolled_to_variable" ? "rolled_to_variable" : "active",
        },
        fixedRollover: {
          ...(current.loan.fixedRollover || {}),
          enabled: true,
          rolloverDate: value,
          rolloverBehaviour: "merge_into_variable",
        },
      },
    }));
  };
  const downloadFile = (content, filename, type = "application/json") => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const todayStamp = () => new Date().toISOString().slice(0, 10);
  const downloadJson = (payload, filename) => downloadFile(JSON.stringify(payload, null, 2), filename, "application/json");
  const downloadCsv = (csv, filename) => downloadFile(csv, filename, "text/csv;charset=utf-8");

  const exportBackup = () => {
    downloadJson(state, `nosik-full-restore-backup-${todayStamp()}.json`);
    setState((current) => ({
      ...current,
      debug: { ...(current.debug || {}), lastBackupExportedAt: new Date().toISOString() },
    }), { type: "backup_exported", title: "Full restore backup exported", source: "setup", force: true });
    setBackupMessage("Full restore backup downloaded. Save this JSON file to Google Drive.");
  };

  const exportDebug = () => {
    downloadJson(exportDebugBundle(state), `nosik-debug-bundle-${todayStamp()}.json`);
    setState((current) => ({
      ...current,
      debug: { ...(current.debug || {}), lastDebugExportedAt: new Date().toISOString() },
    }), { type: "debug_exported", title: "Debug bundle exported", source: "setup", force: true });
    setBackupMessage("Debug bundle downloaded. Keep this with the backup if something needs troubleshooting.");
  };

  const exportArchiveCsv = () => {
    downloadCsv(exportFullArchiveCsv(state), `nosik-full-paid-archive-${todayStamp()}.csv`);
    setState((current) => current, { type: "archive_csv_exported", title: "Full archive CSV exported", source: "setup", force: true });
    setBackupMessage("Full archive CSV downloaded. This one is good for Google Sheets.");
  };

  const exportActionLogCsvFile = () => {
    downloadCsv(exportActionLogCsv(state), `nosik-action-log-${todayStamp()}.csv`);
    setState((current) => current, { type: "action_log_csv_exported", title: "Action log CSV exported", source: "setup", force: true });
    setBackupMessage("Action log CSV downloaded. This one is useful for debugging in Google Sheets.");
  };

  const exportMortgageActivityCsvFile = () => {
    downloadCsv(exportMortgageActivityCsv(state), `nosik-mortgage-activity-${todayStamp()}.csv`);
    setState((current) => current, { type: "mortgage_activity_csv_exported", title: "Mortgage activity CSV exported", source: "setup", force: true });
    setBackupMessage("Mortgage activity CSV downloaded.");
  };

  const exportBalanceSnapshotsCsvFile = () => {
    downloadCsv(exportBalanceSnapshotsCsv(state), `nosik-balance-snapshots-${todayStamp()}.csv`);
    setState((current) => current, { type: "balance_snapshots_csv_exported", title: "Balance snapshots CSV exported", source: "setup", force: true });
    setBackupMessage("Balance snapshots CSV downloaded.");
  };
  const importBackup = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.household || !parsed.income || !parsed.loan || !parsed.accounts) {
        throw new Error("Missing required sections.");
      }
      setState(parsed, { type: "backup_imported", title: "Backup imported", source: "setup", force: true });
      setImportText("");
      setBackupMessage("Backup imported.");
    } catch {
      setBackupMessage("Import failed. Paste a valid Household Finance OS JSON backup.");
    }
  };

  const finishSetup = () => {
    setState((current) => ({
      ...current,
      household: {
        ...current.household,
        setupComplete: true,
      },
    }), { type: "setup_completed", title: "Setup completed", source: "setup", force: true });
    onComplete?.();
  };

  return (
    <section className="page-stack setup-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Household settings</h1>
          <p className="section-copy">Setup is for changes to income, rules, loan details and the SWAN floor. Dashboard stays the daily-use page.</p>
        </div>
        <div className="header-actions">
          <span className={`pill ${swan.tone}`}>{swan.label}</span>
          <button className="danger-button" onClick={() => setConfirmClear(true)}>Clear all</button>
        </div>
      </div>

      <article className={`panel go-live-panel ${checklist.ready ? "ready" : ""}`}>
        <div className="panel-heading">
          <div>
            <h2>Go Live checklist</h2>
            <p>{checklist.ready ? "Ready for real data." : `${checklist.complete} of ${checklist.total} ready before live use.`}</p>
          </div>
          <span className={`pill ${checklist.ready ? "safe" : "warning"}`}>{checklist.ready ? "Ready" : "Not yet"}</span>
        </div>
        <div className="checklist-grid">
          {checklist.items.map((item) => (
            <div className={item.done ? "done" : ""} key={item.label}>
              <strong>{item.done ? "✓" : "!"} {item.label}</strong>
              <span>{item.helper}</span>
            </div>
          ))}
        </div>
      </article>

      {confirmClear && (
        <article className="panel danger-panel">
          <div>
            <h2>Clear all local data?</h2>
            <p>This removes bills, archive, balances, income and loan settings from this browser so you can start live with a fresh slate.</p>
          </div>
          <div className="preset-row">
            <button className="danger-button" onClick={() => { clearAllData(); setConfirmClear(false); }}>Yes, clear everything</button>
            <button onClick={() => setConfirmClear(false)}>Cancel</button>
          </div>
        </article>
      )}

      {cloudSync && <CloudSyncPanel cloudSync={cloudSync} householdName={state.household.householdName} />}

      <article className="panel backup-panel">
        <div className="panel-heading">
          <div>
            <h2>Backup and restore</h2>
            <p>Download a restore backup before going live, then save it to Google Drive. Cloud sync is helpful, but backups are the rollback plan. CSV files are for Google Sheets and debugging.</p>
          </div>
          <span className="pill">Local device storage</span>
        </div>

        <div className="backup-grid">
          <div className="backup-card important">
            <strong>Full app backup</strong>
            <small>Use this JSON file to restore the app later. Save it to Google Drive.</small>
            <button className="primary-action" onClick={exportBackup}>Download full backup</button>
          </div>
          <div className="backup-card">
            <strong>Debug bundle</strong>
            <small>Includes app state, full archive, mortgage activity, action log and balance snapshots.</small>
            <button onClick={exportDebug}>Download debug bundle</button>
          </div>
          <div className="backup-card">
            <strong>Full bill archive CSV</strong>
            <small>Open this in Google Sheets to read every saved paid bill.</small>
            <button onClick={exportArchiveCsv}>Download archive CSV</button>
          </div>
          <div className="backup-card">
            <strong>App action log CSV</strong>
            <small>Open this in Google Sheets to see what the app changed and when.</small>
            <button onClick={exportActionLogCsvFile}>Download action log CSV</button>
          </div>
          <div className="backup-card">
            <strong>Mortgage activity CSV</strong>
            <small>Loan checks, top-ups, extra repayments and rollover records.</small>
            <button onClick={exportMortgageActivityCsvFile}>Download mortgage CSV</button>
          </div>
          <div className="backup-card">
            <strong>Balance snapshots CSV</strong>
            <small>Point-in-time account and loan snapshots for troubleshooting drift.</small>
            <button onClick={exportBalanceSnapshotsCsvFile}>Download snapshots CSV</button>
          </div>
        </div>

        <details>
          <summary>Import full app backup JSON</summary>
          <textarea className="csv-preview" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste the full app backup JSON here" />
          <div className="preset-row">
            <button onClick={importBackup}>Import backup</button>
          </div>
        </details>
        {backupMessage && <p className="helper-text">{backupMessage}</p>}
        <div className="inline-note">
          Backup routine: download the full backup JSON weekly and save it to Google Drive. Cloud sync shares the live household state; JSON backup is still your recovery file. Use the CSV files for Google Sheets; use the JSON file for restore.
        </div>
      </article>

      <div className="wizard-shell">
        <aside className="wizard-steps">
          {steps.map((label, index) => (
            <button className={step === index ? "active" : ""} key={label} onClick={() => setStep(index)}>
              <span>{index + 1}</span>{label}
            </button>
          ))}
        </aside>

        <article className="panel wizard-panel">
          {step === 0 && (
            <div className="wizard-content">
              <h2>Household</h2>
              <p className="section-copy">These names appear throughout partner-facing summaries.</p>
              <div className="form-grid">
                <Field label="Household name"><input value={state.household.householdName} onChange={(e) => patch(["household", "householdName"], e.target.value)} /></Field>
                <Field label="Partner A name"><input value={state.household.partnerAName} onChange={(e) => patch(["household", "partnerAName"], e.target.value)} /></Field>
                <Field label="Partner B name"><input value={state.household.partnerBName} onChange={(e) => patch(["household", "partnerBName"], e.target.value)} /></Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-content">
              <h2>Income routing</h2>
              <p className="section-copy">For this household model, Carl is locked to offset and Kim is locked to external bills. Opposite fortnights are the backbone.</p>
              {staggerWarning && <div className="inline-warning">Paydays are not roughly one week apart. The fortnight engine works best when they alternate.</div>}
              <div className="form-grid">
                <Field label={`${getPartnerName(state, "A")} fortnightly income`}><input type="number" value={incomeA.amount} onChange={(e) => patchIncome("A", "amount", n(e.target.value))} /></Field>
                <Field label={`${getPartnerName(state, "A")} route`} helper="Locked by the brief: offset, mortgage, overflow."><input value="Offset" disabled /></Field>
                <Field label={`${getPartnerName(state, "A")} next payday`}><input type="date" value={incomeA.nextPaydate} onChange={(e) => patchIncome("A", "nextPaydate", e.target.value)} /></Field>
                <Field label={`${getPartnerName(state, "B")} fortnightly income`}><input type="number" value={incomeB.amount} onChange={(e) => patchIncome("B", "amount", n(e.target.value))} /></Field>
                <Field label={`${getPartnerName(state, "B")} route`} helper="Locked by the brief: external bills account."><input value="External bill account" disabled /></Field>
                <Field label={`${getPartnerName(state, "B")} next payday`}><input type="date" value={incomeB.nextPaydate} onChange={(e) => patchIncome("B", "nextPaydate", e.target.value)} /></Field>
                <Field label="Starting external bill account balance" helper="After setup, this should be driven by income, bills and transactions.">
                  <input type="number" value={state.accounts.externalBalance} onChange={(e) => patch(["accounts", "externalBalance"], n(e.target.value))} />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-content">
              <h2>Bill rules</h2>
              <p className="section-copy">This is the money path the ledger uses when a bill is set to Auto.</p>
              <div className="flow-lanes">
                <div className="flow-lane">
                  <h3>{getPartnerName(state, "A")} flow</h3>
                  <div className="flow-steps"><span>Income A</span><i /><span>Offset</span><i /><span>Mortgage + overflow</span></div>
                  <p>Carl's surplus increases offset. It is never counted as an expense.</p>
                </div>
                <div className="flow-lane">
                  <h3>{getPartnerName(state, "B")} flow</h3>
                  <div className="flow-steps"><span>Income B</span><i /><span>Bills</span><i /><span>Forgotten reset</span></div>
                  <p>Kim's running balance covers bills in due-date order. Unused cash resets next pay unless you later change this rule.</p>
                </div>
              </div>
              <div className="form-grid">
                <Field label="Main bill handler"><input value={getPartnerName(state, "B")} disabled /></Field>
                <Field label="Overflow handler"><input value={getPartnerName(state, "A")} disabled /></Field>
                <Field label="Mortgage paid by"><input value={`${getPartnerName(state, "A")} offset`} disabled /></Field>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-content">
              <h2>Loan setup</h2>
              <div className="form-grid">
                <Field label="Loan mode">
                  <select value={state.loan.mode} onChange={(e) => patch(["loan", "mode"], e.target.value)}>
                    <option value="single">Single</option>
                    <option value="split">Split</option>
                  </select>
                </Field>
                {state.loan.mode === "split" ? (
                  <>
                    <Field label="Total loan balance" helper="Changing this adjusts the variable split so the dashboard updates straight away.">
                      <input type="number" value={state.loan.totalBalance} onChange={(e) => updateSplitTotal(e.target.value)} />
                    </Field>
                    <Field label="Fixed balance"><input type="number" value={state.loan.fixed.balance} onChange={(e) => patch(["loan", "fixed", "balance"], n(e.target.value))} /></Field>
                    <Field label="Fixed rate"><input type="number" value={state.loan.fixed.rate} onChange={(e) => patch(["loan", "fixed", "rate"], n(e.target.value))} /></Field>
                    <Field label="Fixed term" helper="Used for rollover planning. Edit the end date for custom terms.">
                      <select value={state.loan.fixed.fixedTermYears || 2} onChange={(e) => updateFixedTermYears(e.target.value)}>
                        <option value="1">1 year</option>
                        <option value="2">2 years</option>
                        <option value="3">3 years</option>
                        <option value="4">4 years</option>
                        <option value="5">5 years</option>
                        <option value="10">10 years</option>
                      </select>
                    </Field>
                    <Field label="Fixed start date"><input type="date" value={state.loan.fixed.fixedStartDate || ""} onChange={(e) => patch(["loan", "fixed", "fixedStartDate"], e.target.value)} /></Field>
                    <Field label="Fixed end date" helper="When this passes, the remaining fixed balance rolls into the variable split."><input type="date" value={state.loan.fixed.fixedEndDate || ""} onChange={(e) => updateFixedEndDate(e.target.value)} /></Field>
                    <Field label="Variable balance"><input type="number" value={state.loan.variable.balance} onChange={(e) => patch(["loan", "variable", "balance"], n(e.target.value))} /></Field>
                    <Field label="Variable rate"><input type="number" value={state.loan.variable.rate} onChange={(e) => patch(["loan", "variable", "rate"], n(e.target.value))} /></Field>
                    <Field label="Fixed repayment share" helper="Optional. If blank, the app allocates the repayment proportionally."><input type="number" value={state.loan.fixed.repaymentAmount || 0} onChange={(e) => patch(["loan", "fixed", "repaymentAmount"], n(e.target.value))} /></Field>
                    <Field label="Variable repayment share" helper="Optional. Variable split is offset-linked."><input type="number" value={state.loan.variable.repaymentAmount || 0} onChange={(e) => patch(["loan", "variable", "repaymentAmount"], n(e.target.value))} /></Field>
                  </>
                ) : (
                  <>
                    <Field label="Single balance"><input type="number" value={state.loan.single.balance} onChange={(e) => patch(["loan", "single", "balance"], n(e.target.value))} /></Field>
                    <Field label="Single rate"><input type="number" value={state.loan.single.rate} onChange={(e) => patch(["loan", "single", "rate"], n(e.target.value))} /></Field>
                  </>
                )}
                <Field label="Fallback mortgage payment" helper="Used when split repayment shares are not entered.">
                  <input type="number" value={state.loan.repayment} onChange={(e) => patch(["loan", "repayment"], n(e.target.value))} />
                </Field>
                <Field label="Repayment frequency" helper="Controls payment date roll-forward and interest period.">
                  <select value={state.loan.repaymentFrequency || "fortnightly"} onChange={(e) => patch(["loan", "repaymentFrequency"], e.target.value)}>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </Field>
                <Field label="Next mortgage payment date" helper="This controls the locked mortgage bill due date.">
                  <input type="date" value={state.loan.nextPaymentDate} onChange={(e) => patch(["loan", "nextPaymentDate"], e.target.value)} />
                </Field>
                <Field label="Balance check frequency" helper="How often the app asks you to confirm the bank numbers.">
                  <select value={state.loan.reconciliationFrequency || "weekly"} onChange={(e) => patch(["loan", "reconciliationFrequency"], e.target.value)}>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                  </select>
                </Field>
                <Field label="Next balance check date" helper="Used by the Monday summary/check-in preview.">
                  <input type="date" value={state.loan.nextReconciliationDate || ""} onChange={(e) => patch(["loan", "nextReconciliationDate"], e.target.value)} />
                </Field>
              </div>
              {loanWarnings.length > 0 && <div className="inline-warning">{loanWarnings.join(" ")}</div>}
            </div>
          )}

          {step === 4 && (
            <div className="wizard-content">
              <h2>Safety buffer</h2>
              <p className="section-copy">The SWAN floor is a hard guardrail for suggestions, deferrals and stress tests.</p>
              <div className="form-grid">
                <Field label="Starting offset balance"><input type="number" value={state.accounts.offset.balance} onChange={(e) => patch(["accounts", "offset", "balance"], n(e.target.value))} /></Field>
                <Field label="SWAN floor emergency target"><input type="number" value={state.accounts.offset.swanFloor} onChange={(e) => patch(["accounts", "offset", "swanFloor"], n(e.target.value))} /></Field>
              </div>
              <ProgressBar label="SWAN floor" value={swan.progress} detail={`${currency(state.accounts.offset.balance)} of ${currency(state.accounts.offset.swanFloor)}`} tone={swan.tone} />
            </div>
          )}

          {step === 5 && (
            <div className="wizard-content">
              <h2>Review</h2>
              <p className="section-copy">{sim.flagged.length || loanWarnings.length ? "Needs attention before it feels fully calm." : "Looks good. Dashboard is ready for daily use."}</p>
              <div className="metrics-grid single">
                <MetricCard label="Fortnight bills" value={sim.dueTotal} />
                <MetricCard label="Breathing room" value={sim.breathingRoom} tone={sim.breathingRoom >= 0 ? "safe" : "issue"} />
                <MetricCard label="SWAN gap" value={swan.gap} tone={swan.tone} />
                <MetricCard label="Flagged bills" value={sim.flagged.length} money={false} tone={sim.flagged.length ? "warning" : "safe"} />
              </div>
              <div className="review-grid">
                <div>
                  <strong>Income</strong>
                  <span>{getPartnerName(state, "A")}: {currency(incomeA.amount)} · {incomeA.nextPaydate}</span>
                  <span>{getPartnerName(state, "B")}: {currency(incomeB.amount)} · {incomeB.nextPaydate}</span>
                </div>
                <div>
                  <strong>Loan</strong>
                  <span>{state.loan.mode === "split" ? `Fixed ${currency(state.loan.fixed.balance)} + Variable ${currency(state.loan.variable.balance)}` : currency(state.loan.single.balance)}</span>
                  <span>Repayment {currency(state.loan.repayment)} · next {state.loan.nextPaymentDate}</span>
                </div>
                <div>
                  <strong>Safety</strong>
                  <span>Offset {currency(state.accounts.offset.balance)} · floor {currency(state.accounts.offset.swanFloor)}</span>
                  <span>Balance check: {state.loan.reconciliationFrequency} · next {state.loan.nextReconciliationDate}</span>
                </div>
                <div>
                  <strong>Data</strong>
                  <span>Paid archive saved: {(state.debug?.fullArchive?.length || state.archive?.length || 0)} records</span>
                  <span>Action log saved: {(state.debug?.actionLog?.length || 0)} entries</span>
                </div>
              </div>
            </div>
          )}

          <div className="wizard-actions">
            <button disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>Back</button>
            <button onClick={() => (step === steps.length - 1 ? finishSetup() : setStep((current) => Math.min(steps.length - 1, current + 1)))}>{step === steps.length - 1 ? "Done" : "Continue"}</button>
          </div>
        </article>
      </div>
    </section>
  );
}
