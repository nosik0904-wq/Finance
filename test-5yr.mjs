/**
 * 5-year math verification test for Household Finance OS
 *
 * Runs 130 fortnights (5 years) checking math invariants at every step.
 * The simulation credits income each fortnight and advances the mortgage
 * due date — mirroring what a user would do manually via Setup.
 */

import { sampleState } from "./src/data/sampleData.js";
import {
  addDays,
  calculateLoanMetrics,
  getNextDueDate,
  getBillOccurrences,
  daysBetween,
  currency,
} from "./src/logic/financeCalculations.js";
import {
  simulateFortnight,
  applyBillPaid,
  ensureMortgageEntry,
  deepClone,
  getIncome,
} from "./src/logic/engine.js";
import { getFreedomDate, getSwanStatus } from "./src/logic/reporting.js";
import { reconcileMortgageBalances } from "./src/logic/loanLogic.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

const AUD = (v) => `$${Number(v).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const pct = (v) => `${Number(v).toFixed(2)}%`;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`FAIL [${label}]${detail ? ": " + detail : ""}`);
  }
}

function noNaN(val, label) {
  const ok = typeof val === "number" && isFinite(val) && val !== null;
  check(`${label} is finite number`, ok, `got ${val} (${typeof val})`);
}

// ─── correct fortnight advance ────────────────────────────────────────────────
// Models what a diligent user does each fortnight:
//   1. Income lands in the right account
//   2. Simulation runs and auto-assumed bills are marked paid
//   3. Mortgage next-payment-date advances so ensureMortgageEntry stays current

function advanceFortnight(state, currentDate) {
  const nextDate = addDays(currentDate, 14);
  let next = deepClone(state);

  // Credit income when payday falls inside this fortnight
  next.income = next.income.map((inc) => {
    if (inc.nextPaydate >= currentDate && inc.nextPaydate < nextDate) {
      if (inc.route === "offset") {
        next.accounts.offset.balance += Number(inc.amount || 0);
      } else {
        next.accounts.externalBalance += Number(inc.amount || 0);
      }
      return { ...inc, nextPaydate: addDays(inc.nextPaydate, 14) };
    }
    return inc;
  });

  // Capture the sim AFTER income has landed (same timing as the dashboard)
  const sim = simulateFortnight(next, currentDate);

  // Pay auto-assumed bills whose due date falls within this fortnight.
  // Mortgage payments should reduce only the estimated principal and should
  // advance loan.nextPaymentDate inside applyBillPaid.
  for (const row of sim.rows) {
    if (row.simulatedStatus === "autoAssumed" && row.dueDate < nextDate) {
      next = applyBillPaid(next, row.id, row.dueDate);
      if (row.locked) {
        const updatedMortgage = next.bills.find((b) => b.locked);
        check(
          `Mortgage nextPaymentDate syncs after payment FN${currentDate}`,
          !!updatedMortgage && next.loan.nextPaymentDate === updatedMortgage.dueDate,
          `loan=${next.loan.nextPaymentDate} bill=${updatedMortgage?.dueDate}`
        );
      }
    }
  }

  return { state: ensureMortgageEntry(next), sim, date: nextDate };
}

// ─── bill occurrence counter ──────────────────────────────────────────────────

function countOccurrences(bill, startDate, years) {
  return getBillOccurrences(bill, startDate, years * 365).length;
}

// ═══════════════════════════════════════════════════════════════════════════════

const START_DATE = "2026-04-29";
const YEARS = 5;
const FORTNIGHTS = YEARS * 26; // 130

console.log("═══════════════════════════════════════════════════════");
console.log("  Household Finance OS — 5-Year Math Verification");
console.log(`  ${FORTNIGHTS} fortnights × 2 weeks = ${YEARS} years`);
console.log("═══════════════════════════════════════════════════════\n");

// ─── Section 0: Static sanity checks ─────────────────────────────────────────

console.log("── Section 0: Static sanity ──────────────────────────");

const initialState = ensureMortgageEntry(deepClone(sampleState));
const initialMetrics = calculateLoanMetrics(initialState);

// Weighted rate = weighted average of fixed + variable
const manualWeighted =
  (initialState.loan.fixed.balance * initialState.loan.fixed.rate +
    initialState.loan.variable.balance * initialState.loan.variable.rate) /
  (initialState.loan.fixed.balance + initialState.loan.variable.balance);

check(
  "Weighted rate matches manual blend",
  Math.abs(initialMetrics.weightedRate - manualWeighted) < 0.0001,
  `engine=${pct(initialMetrics.weightedRate)} manual=${pct(manualWeighted)}`
);

noNaN(initialMetrics.dailyGrossInterest, "dailyGrossInterest");
noNaN(initialMetrics.dailyNetInterest,   "dailyNetInterest");
noNaN(initialMetrics.offsetCredit,       "offsetCredit");

check(
  "Net interest ≤ gross interest",
  initialMetrics.dailyNetInterest <= initialMetrics.dailyGrossInterest,
  `net=${AUD(initialMetrics.dailyNetInterest)} gross=${AUD(initialMetrics.dailyGrossInterest)}`
);

check(
  "Offset credit > 0 (offset is reducing interest)",
  initialMetrics.offsetCredit > 0,
  `offsetCredit=${AUD(initialMetrics.offsetCredit)}`
);

// Gross daily interest: (fixedBal × fixedRate + varBal × varRate) / 100 / 365
const manualGross =
  (initialState.loan.fixed.balance   * initialState.loan.fixed.rate   +
   initialState.loan.variable.balance * initialState.loan.variable.rate) / 100 / 365;

check(
  "Gross interest matches manual formula",
  Math.abs(initialMetrics.dailyGrossInterest - manualGross) < 0.01,
  `engine=${AUD(initialMetrics.dailyGrossInterest)} manual=${AUD(manualGross)}`
);

// Net interest: offset credit = min(offset, varBalance) × varRate / 100 / 365
const offsetApplied = Math.min(
  initialState.accounts.offset.balance,
  initialState.loan.variable.balance
);
const manualOffsetCredit = (offsetApplied * initialState.loan.variable.rate) / 100 / 365;
const manualNet = manualGross - manualOffsetCredit;

check(
  "Net interest matches manual formula",
  Math.abs(initialMetrics.dailyNetInterest - manualNet) < 0.01,
  `engine=${AUD(initialMetrics.dailyNetInterest)} manual=${AUD(manualNet)}`
);

// Fortnightly net interest plausibility for $782k loan
const fnInterest = initialMetrics.dailyNetInterest * 14;
check(
  "Fortnightly net interest is plausible ($500–$2000)",
  fnInterest >= 500 && fnInterest <= 2000,
  `${AUD(fnInterest)}`
);

// SWAN floor
const initialSwan = getSwanStatus(initialState);
check(
  "Initial SWAN is safe",
  initialSwan.tone === "safe",
  `offset=${AUD(initialState.accounts.offset.balance)} floor=${AUD(initialState.accounts.offset.swanFloor)}`
);

// Freedom date
const freedom = getFreedomDate(initialState, initialMetrics);
noNaN(freedom.years, "freedom.years");
check(
  "Freedom date in plausible range (5–40 years)",
  freedom.years >= 5 && freedom.years <= 40,
  `${freedom.label} (${freedom.year})`
);

// Bill recurrence counts over 5 years
const schoolFees   = initialState.bills.find((b) => b.id === "bill-school-fees");
const groceries    = initialState.bills.find((b) => b.id === "bill-groceries");
const energy       = initialState.bills.find((b) => b.id === "bill-energy");
const carInsurance = initialState.bills.find((b) => b.id === "bill-car-insurance");
const councilRates = initialState.bills.find((b) => b.id === "bill-council-rates");
const medical      = initialState.bills.find((b) => b.id === "bill-medical");

if (schoolFees)   check("Monthly school fees: ~60 in 5yr",      countOccurrences(schoolFees,   START_DATE, 5) >= 58 && countOccurrences(schoolFees,   START_DATE, 5) <= 62, `got ${countOccurrences(schoolFees,   START_DATE, 5)}`);
if (groceries)    check("Fortnightly groceries: ~130 in 5yr",    countOccurrences(groceries,    START_DATE, 5) >= 128 && countOccurrences(groceries,    START_DATE, 5) <= 132, `got ${countOccurrences(groceries,    START_DATE, 5)}`);
if (energy)       check("Monthly energy: ~60 in 5yr",            countOccurrences(energy,       START_DATE, 5) >= 58 && countOccurrences(energy,       START_DATE, 5) <= 62, `got ${countOccurrences(energy,       START_DATE, 5)}`);
if (carInsurance) check("Annual car insurance: ~5 in 5yr",       countOccurrences(carInsurance, START_DATE, 5) >= 4  && countOccurrences(carInsurance, START_DATE, 5) <= 6,  `got ${countOccurrences(carInsurance, START_DATE, 5)}`);
if (councilRates) check("Quarterly council rates: ~20 in 5yr",   countOccurrences(councilRates, START_DATE, 5) >= 18 && countOccurrences(councilRates, START_DATE, 5) <= 22, `got ${countOccurrences(councilRates, START_DATE, 5)}`);
if (medical)      check("One-off medical: exactly 1 occurrence",  countOccurrences(medical,      START_DATE, 5) === 1, `got ${countOccurrences(medical, START_DATE, 5)}`);

console.log(`  Static checks: ${passed} passed, ${failed} failed\n`);

// ─── Section 1: Rolling 5-year simulation ─────────────────────────────────────

console.log("── Section 1: Rolling 5-year simulation ─────────────");

let state = deepClone(initialState);
let currentDate = START_DATE;

let totalInterestAccrued = 0;
let minSwan = Infinity;
let maxScore = 0;
let minScore = 100;
let swanBreaches = 0;
let nanCount = 0;
const perFnFailures = [];

const startOffset   = state.accounts.offset.balance;     // $48,600
const startExternal = state.accounts.externalBalance;     // $1,000

for (let fn = 0; fn < FORTNIGHTS; fn++) {
  const { state: nextState, sim, date: nextDate } = advanceFortnight(state, currentDate);

  // ── NaN / finiteness ──────────────────────────────────────────────────────
  const keyNumbers = {
    score: sim.score,
    breathingRoom: sim.breathingRoom,
    dueTotal: sim.dueTotal,
    swanGap: sim.swan.gap,
    weightedRate: sim.loanMetrics.weightedRate,
    dailyNetInterest: sim.loanMetrics.dailyNetInterest,
    dailyGrossInterest: sim.loanMetrics.dailyGrossInterest,
  };
  for (const [key, val] of Object.entries(keyNumbers)) {
    if (!isFinite(val) || val === null) {
      nanCount++;
      perFnFailures.push(`FN${fn + 1} (${currentDate}): NaN/Inf in ${key} = ${val}`);
    }
  }

  // ── Score 0–100 ───────────────────────────────────────────────────────────
  if (sim.score < 0 || sim.score > 100) {
    perFnFailures.push(`FN${fn + 1} (${currentDate}): score out of range: ${sim.score}`);
  }

  // ── breathingRoom = combinedIncome - dueTotal ─────────────────────────────
  const incA = getIncome(nextState, "A");
  const incB = getIncome(nextState, "B");
  const combinedIncome = Number(incA.amount || 0) + Number(incB.amount || 0);
  const expectedBreathing = combinedIncome - sim.dueTotal;
  if (Math.abs(sim.breathingRoom - expectedBreathing) > 1) {
    perFnFailures.push(
      `FN${fn + 1} (${currentDate}): breathingRoom mismatch — expected ${expectedBreathing.toFixed(0)} got ${sim.breathingRoom.toFixed(0)}`
    );
  }

  // ── SWAN gap = offsetAfter - floor ────────────────────────────────────────
  const swanFloor = nextState.accounts.offset.swanFloor;
  const expectedSwanGap = sim.offsetAfter - swanFloor;
  if (Math.abs(sim.swan.gap - expectedSwanGap) > 1) {
    perFnFailures.push(
      `FN${fn + 1} (${currentDate}): swan.gap mismatch — expected ${expectedSwanGap.toFixed(0)} got ${sim.swan.gap.toFixed(0)}`
    );
  }

  // ── Net interest ≤ gross ──────────────────────────────────────────────────
  if (sim.loanMetrics.dailyNetInterest > sim.loanMetrics.dailyGrossInterest + 0.01) {
    perFnFailures.push(
      `FN${fn + 1} (${currentDate}): net > gross — net=${sim.loanMetrics.dailyNetInterest.toFixed(4)} gross=${sim.loanMetrics.dailyGrossInterest.toFixed(4)}`
    );
  }

  // ── Weighted rate matches manual blend ────────────────────────────────────
  // simulateFortnight calculates loan metrics at the start of the fortnight after
  // ensureMortgageEntry has applied any fixed-rate rollover. Compare against that
  // same loan state, not the end-of-fortnight post-payment state.
  const loan = ensureMortgageEntry(deepClone(state), currentDate).loan;
  const totalBal = loan.fixed.balance + loan.variable.balance;
  if (totalBal > 0) {
    const expectedWR = (loan.fixed.balance * loan.fixed.rate + loan.variable.balance * loan.variable.rate) / totalBal;
    if (Math.abs(sim.loanMetrics.weightedRate - expectedWR) > 0.001) {
      perFnFailures.push(
        `FN${fn + 1} (${currentDate}): weightedRate mismatch — engine=${sim.loanMetrics.weightedRate.toFixed(4)} manual=${expectedWR.toFixed(4)}`
      );
    }
  }

  // ── Offset credit capped at variable loan balance ─────────────────────────
  const maxCredit = (loan.variable.balance * loan.variable.rate) / 100 / 365;
  if (sim.loanMetrics.offsetCredit > maxCredit + 0.01) {
    perFnFailures.push(
      `FN${fn + 1} (${currentDate}): offsetCredit exceeds cap — credit=${sim.loanMetrics.offsetCredit.toFixed(4)} cap=${maxCredit.toFixed(4)}`
    );
  }

  // Track aggregates
  totalInterestAccrued += sim.loanMetrics.dailyNetInterest * 14;
  if (sim.swan.gap < 0) swanBreaches++;
  minSwan  = Math.min(minSwan,  sim.swan.gap);
  maxScore = Math.max(maxScore, sim.score);
  minScore = Math.min(minScore, sim.score);

  state = nextState;
  currentDate = nextDate;

  // Annual progress tick
  if ((fn + 1) % 26 === 0) {
    const yr = (fn + 1) / 26;
    const metrics = calculateLoanMetrics(state);
    const swan = getSwanStatus(state);
    console.log(
      `  Year ${yr}: offset=${AUD(state.accounts.offset.balance)} ` +
      `external=${AUD(state.accounts.externalBalance)} ` +
      `netInt/day=${AUD(metrics.dailyNetInterest)} ` +
      `SWAN=${swan.label} score=${sim.score}`
    );
  }
}

console.log();

// Register per-fortnight failures
const maxToShow = 10;
if (perFnFailures.length > 0) {
  perFnFailures.slice(0, maxToShow).forEach((msg) => {
    console.log(`  ⚠  ${msg}`);
    failures.push(msg);
    failed++;
  });
  if (perFnFailures.length > maxToShow) {
    console.log(`  … and ${perFnFailures.length - maxToShow} more`);
  }
} else {
  console.log("  All per-fortnight invariants passed ✓");
}

check("No NaN/Inf encountered across all 130 fortnights", nanCount === 0, `${nanCount} occurrences`);
check("Health score always 0–100", minScore >= 0 && maxScore <= 100, `min=${minScore} max=${maxScore}`);

// ─── Section 2: End-of-run aggregate checks ───────────────────────────────────

console.log("\n── Section 2: 5-year aggregate math ─────────────────");

const finalMetrics = calculateLoanMetrics(state);
const endOffset   = state.accounts.offset.balance;
const endExternal = state.accounts.externalBalance;

console.log(`  Start offset:          ${AUD(startOffset)}`);
console.log(`  End offset:            ${AUD(endOffset)}`);
console.log(`  Start external:        ${AUD(startExternal)}`);
console.log(`  End external:          ${AUD(endExternal)}`);
console.log(`  Total interest (net):  ${AUD(totalInterestAccrued)}`);
console.log(`  Annual avg interest:   ${AUD(totalInterestAccrued / YEARS)}`);
console.log(`  Score range:           ${minScore}–${maxScore}`);
console.log(`  Min SWAN gap:          ${AUD(minSwan)}`);
console.log(`  SWAN breaches:         ${swanBreaches}`);

// Annual interest should be plausible for ~$782k loan at ~6.2% with ~$48k offset
// (gross ~$48k/yr, net somewhat less due to offset working)
const yearlyInterestApprox = totalInterestAccrued / YEARS;
check(
  "Annual net interest plausible ($30k–$55k/yr for this loan)",
  yearlyInterestApprox >= 30000 && yearlyInterestApprox <= 55000,
  `${AUD(yearlyInterestApprox)}/yr`
);

// Offset balance should be positive at end (income > bills)
check(
  "Offset balance positive at end of 5yr",
  endOffset >= 0,
  `${AUD(endOffset)}`
);

// External account should be positive at end
check(
  "External account positive at end of 5yr",
  endExternal >= 0,
  `${AUD(endExternal)}`
);

// Estimated balances should reduce automatically, while bank-confirmed balances stay unchanged until reconciliation.
const mortgagePayments = state.archive.filter((entry) => /mortgage/i.test(entry.name || ""));
const startingLoanTotal = initialState.loan.fixed.balance + initialState.loan.variable.balance;
const endingLoanTotal = state.loan.fixed.balance + state.loan.variable.balance;
const estimatedPrincipalPaid = startingLoanTotal - endingLoanTotal;
const fullMortgageCashPaid = mortgagePayments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

check(
  "Estimated total loan balance reduces after mortgage payments",
  endingLoanTotal < startingLoanTotal,
  `start=${AUD(startingLoanTotal)} end=${AUD(endingLoanTotal)} fixed=${AUD(state.loan.fixed.balance)} var=${AUD(state.loan.variable.balance)}`
);

check(
  "Fixed rollover can move fixed balance into variable without increasing total debt",
  state.loan.fixed.status === "rolled_to_variable"
    ? state.loan.fixed.balance === 0 && state.loan.variable.balance < startingLoanTotal
    : state.loan.fixed.balance < initialState.loan.fixed.balance && state.loan.variable.balance < initialState.loan.variable.balance,
  `status=${state.loan.fixed.status} fixed=${AUD(state.loan.fixed.balance)} var=${AUD(state.loan.variable.balance)}`
);

check(
  "Loan reduction is estimated principal only, not full cash repayment",
  estimatedPrincipalPaid > 0 && estimatedPrincipalPaid < fullMortgageCashPaid,
  `principal=${AUD(estimatedPrincipalPaid)} full repayments=${AUD(fullMortgageCashPaid)}`
);

const startingConfirmedTotal = Number(initialState.loan.fixed.confirmedBalance || 0) + Number(initialState.loan.variable.confirmedBalance || 0);
const endingConfirmedTotal = Number(state.loan.fixed.confirmedBalance || 0) + Number(state.loan.variable.confirmedBalance || 0);
check(
  "Confirmed total does not reduce without manual reconciliation",
  endingConfirmedTotal === startingConfirmedTotal,
  `start confirmed=${AUD(startingConfirmedTotal)} end confirmed=${AUD(endingConfirmedTotal)}`
);

const reconciled = reconcileMortgageBalances(
  state,
  { fixedBalance: 210000, variableBalance: 226000, offsetBalance: 99000 },
  currentDate
);
check(
  "Manual reconciliation updates fixed, variable and offset confirmed balances",
  reconciled.loan.fixed.confirmedBalance === 210000 &&
  reconciled.loan.variable.confirmedBalance === 226000 &&
  reconciled.accounts.offset.confirmedBalance === 99000,
  `fixed=${AUD(reconciled.loan.fixed.confirmedBalance)} var=${AUD(reconciled.loan.variable.confirmedBalance)} offset=${AUD(reconciled.accounts.offset.confirmedBalance)}`
);
check(
  "Manual reconciliation resets estimates to bank truth and advances next check",
  reconciled.loan.fixed.balance === reconciled.loan.fixed.confirmedBalance &&
  reconciled.loan.variable.balance === reconciled.loan.variable.confirmedBalance &&
  reconciled.accounts.offset.balance === reconciled.accounts.offset.confirmedBalance &&
  reconciled.loan.nextReconciliationDate > currentDate,
  `nextCheck=${reconciled.loan.nextReconciliationDate}`
);

// Mortgage bill still locked
const mortgageBill = state.bills.find((b) => b.locked);
check("Locked mortgage bill still present after 5yr", !!mortgageBill);
if (mortgageBill) {
  check(
    "Mortgage due date has advanced into the future",
    mortgageBill.dueDate >= currentDate,
    `dueDate=${mortgageBill.dueDate} currentDate=${currentDate}`
  );
}

// Archive should have accumulated many paid records
const archiveCount = (state.archive || []).length;
check("Archive accumulated paid records (>50)", archiveCount > 50, `${archiveCount} entries`);
console.log(`  Archive entries:       ${archiveCount}`);

// ─── Section 3: Bill recurrence math spot checks ──────────────────────────────

console.log("\n── Section 3: Bill recurrence math ──────────────────");

const testCases = [
  { bill: { dueDate: "2026-05-01", recurrence: "monthly",     startDate: "2026-05-01" }, minDays: 28, maxDays: 31, label: "monthly" },
  { bill: { dueDate: "2026-05-01", recurrence: "fortnightly"                          }, minDays: 14, maxDays: 14, label: "fortnightly" },
  { bill: { dueDate: "2026-05-01", recurrence: "quarterly",   startDate: "2026-05-01" }, minDays: 89, maxDays: 92, label: "quarterly" },
  { bill: { dueDate: "2026-05-01", recurrence: "annually",    startDate: "2026-05-01" }, minDays: 364, maxDays: 366, label: "annually" },
  { bill: { dueDate: "2026-05-01", recurrence: "weekly"                               }, minDays: 7,  maxDays: 7,  label: "weekly" },
];

for (const tc of testCases) {
  const next = getNextDueDate(tc.bill);
  const days = daysBetween("2026-05-01", next);
  check(
    `getNextDueDate: ${tc.label} advances ${tc.minDays === tc.maxDays ? tc.minDays : tc.minDays + "–" + tc.maxDays} days`,
    days >= tc.minDays && days <= tc.maxDays,
    `${next} (${days} days)`
  );
}

// Month-end clamping: 31 Jan + 1 month should land on 28/29 Feb, not overflow to March
const jan31next = getNextDueDate({ dueDate: "2026-01-31", recurrence: "monthly", startDate: "2026-01-31" });
check(
  "Month-end clamp: Jan-31 + 1 month → Feb (not March)",
  jan31next.startsWith("2026-02"),
  `got ${jan31next}`
);

// ─── Section 4: Edge case math ────────────────────────────────────────────────

console.log("\n── Section 4: Edge cases ────────────────────────────");

// Zero loan
const zeroLoanState = deepClone(sampleState);
zeroLoanState.loan.fixed.balance = 0;
zeroLoanState.loan.variable.balance = 0;
zeroLoanState.loan.totalBalance = 0;
const zeroMetrics = calculateLoanMetrics(zeroLoanState);
check("Zero loan → dailyNetInterest = 0",    zeroMetrics.dailyNetInterest === 0, `got ${zeroMetrics.dailyNetInterest}`);
check("Zero loan → weightedRate = 0",        zeroMetrics.weightedRate === 0,     `got ${zeroMetrics.weightedRate}`);

// Offset equals variable balance → full offset credit
const fullOffState = deepClone(sampleState);
fullOffState.accounts.offset.balance = fullOffState.loan.variable.balance;
const fullOffMetrics = calculateLoanMetrics(fullOffState);
const expectedFullCredit = (fullOffState.loan.variable.balance * fullOffState.loan.variable.rate) / 100 / 365;
check(
  "Offset = variable balance → credit = full variable interest",
  Math.abs(fullOffMetrics.offsetCredit - expectedFullCredit) < 0.01,
  `engine=${fullOffMetrics.offsetCredit.toFixed(4)} expected=${expectedFullCredit.toFixed(4)}`
);

// Offset > variable balance → credit capped
const overOffState = deepClone(sampleState);
overOffState.accounts.offset.balance = overOffState.loan.variable.balance + 100_000;
const overOffMetrics = calculateLoanMetrics(overOffState);
check(
  "Offset > variable balance → credit capped at variable loan interest",
  Math.abs(overOffMetrics.offsetCredit - expectedFullCredit) < 0.01,
  `engine=${overOffMetrics.offsetCredit.toFixed(4)} cap=${expectedFullCredit.toFixed(4)}`
);

// currency() formatting
check("currency(0) = $0",            currency(0) === "$0");
check("currency(1234567) has commas", currency(1234567).includes("1,234,567"), `got ${currency(1234567)}`);
check("currency(-500) contains 500",  currency(-500).includes("500"),          `got ${currency(-500)}`);

// addDays edge cases
check("addDays: Jan 31 + 1 = Feb 1",       addDays("2026-01-31", 1)  === "2026-02-01");
check("addDays: Dec 31 + 1 = Jan 1",       addDays("2026-12-31", 1)  === "2027-01-01");
check("addDays: leap day 2028",            addDays("2028-02-28", 1)  === "2028-02-29");
check("addDays: 0 days = same date",       addDays("2026-05-01", 0)  === "2026-05-01");
check("addDays: 14 days from anchor",      addDays("2026-04-24", 14) === "2026-05-08");

// daysBetween symmetry: daysBetween(a, b) = -daysBetween(b, a)
const d1 = daysBetween("2026-04-01", "2026-05-01"); // 30
const d2 = daysBetween("2026-05-01", "2026-04-01"); // -30
check("daysBetween is antisymmetric", d1 === -d2, `${d1} vs ${d2}`);
check("daysBetween Apr→May = 30", d1 === 30, `got ${d1}`);

// ─── Final report ─────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════");
console.log(`  RESULT: ${passed} passed  |  ${failed} failed`);
console.log("═══════════════════════════════════════════════════════");

if (failures.length > 0) {
  console.log("\n  Failures:\n");
  failures.forEach((msg) => console.log(`  • ${msg}`));
  console.log();
}

process.exit(failed > 0 ? 1 : 0);
