import { sampleState } from "./src/data/sampleData.js";
import { normalizeAuditTrail, appendActionLog, createStateSnapshot, exportActionLogCsv, exportBalanceSnapshotsCsv, exportDebugBundle, exportFullArchiveCsv, exportMortgageActivityCsv } from "./src/logic/auditTrail.js";
import { normalizeState } from "./src/logic/engine.js";
import { deleteLoanActivityEvent, recordExtraLoanRepayment, updateLoanActivityEvent } from "./src/logic/loanLogic.js";

let passed = 0;
let failed = 0;
function expect(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

const base = normalizeState(sampleState, sampleState);
const audited = normalizeAuditTrail(base);
expect("Full archive includes current paid archive", audited.debug.fullArchive.length >= audited.archive.length);

let logged = audited;
for (let i = 0; i < 75; i += 1) {
  const before = createStateSnapshot(logged);
  const next = { ...logged, accounts: { ...logged.accounts, externalBalance: logged.accounts.externalBalance + 1 } };
  logged = appendActionLog(next, { type: "test", title: `Debug event ${i}` }, before, createStateSnapshot(next));
}
expect("Action log is not capped at old 60-entry limit", logged.debug.actionLog.length >= 75);

const beforeRepayment = normalizeState(sampleState, sampleState);
const startVariable = beforeRepayment.loan.variable.balance;
const startOffset = beforeRepayment.accounts.offset.balance;
const paid = recordExtraLoanRepayment(beforeRepayment, { amount: 10000, fromAccount: "offset", targetSplit: "variable", bankConfirmed: true, note: "test" }, "2026-05-01");
const event = paid.loan.activity.find((item) => item.type === "extra_repayment");
expect("Extra repayment stores reversible impact", Boolean(event?.impact?.variableReduction));
expect("Extra repayment reduced variable", Math.round(paid.loan.variable.balance) === Math.round(startVariable - 10000));
expect("Extra repayment reduced offset", Math.round(paid.accounts.offset.balance) === Math.round(startOffset - 10000));

const edited = updateLoanActivityEvent(paid, event.id, { amount: 12000, title: event.title, detail: event.detail, date: event.date }, "2026-05-01");
expect("Editing extra repayment amount adjusts variable", Math.round(edited.loan.variable.balance) === Math.round(startVariable - 12000));
expect("Editing extra repayment amount adjusts offset", Math.round(edited.accounts.offset.balance) === Math.round(startOffset - 12000));

const deleted = deleteLoanActivityEvent(edited, event.id, "2026-05-01");
expect("Deleting extra repayment reverses variable", Math.round(deleted.loan.variable.balance) === Math.round(startVariable));
expect("Deleting extra repayment reverses offset", Math.round(deleted.accounts.offset.balance) === Math.round(startOffset));

const archiveCsv = exportFullArchiveCsv(logged);
const actionCsv = exportActionLogCsv(logged);
const mortgageCsv = exportMortgageActivityCsv(paid);
const snapshotsCsv = exportBalanceSnapshotsCsv(logged);
const debugBundle = exportDebugBundle(logged);
expect("Archive CSV has paidDate header", archiveCsv.startsWith("paidDate,name,amount"));
expect("Action CSV includes action rows", actionCsv.includes("Debug event 74"));
expect("Mortgage activity CSV includes extra repayment", mortgageCsv.includes("extra_repayment"));
expect("Balance snapshots CSV has snapshot header", snapshotsCsv.startsWith("timestamp,date,reason"));
expect("Debug bundle includes balance snapshots", Array.isArray(debugBundle.balanceSnapshots));

console.log(`Audit/debug test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
