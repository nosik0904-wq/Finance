import { addDays, calculateLoanMetrics, currency, daysBetween, getBillAmountRemaining, getOpenAlerts, shortDate } from "./financeCalculations.js";
import { autoAssumePaid } from "./paymentEngine.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPayday(firstPayday, date) {
  if (!firstPayday) return false;
  const distance = daysBetween(firstPayday, date);
  return distance >= 0 && distance % 14 === 0;
}

function flowAccount(partner, household) {
  const flow = partner === "partnerA" ? household.partnerAFlow : household.partnerBFlow;
  const route = partner === "partnerA" ? household.partnerAIncomeRoute : household.partnerBIncomeRoute;

  if (flow === "offset_overflow") return "offset";
  if (flow === "bills" || flow === "mortgage" || flow === "mortgage_bills" || flow === "joint_bills") return "external";
  return route === "offset" ? "offset" : "external";
}

function partnerName(partner, household) {
  return partner === "partnerA" ? household.partnerAName : household.partnerBName;
}

function addIncome(state, partner, date, log) {
  const amount = partner === "partnerA" ? Number(state.household.partnerAFortnightIncome || 0) : Number(state.household.partnerBFortnightIncome || 0);
  const account = flowAccount(partner, state.household);
  if (amount <= 0) return;

  if (account === "offset") state.household.offsetBalance += amount;
  if (account === "external") state.household.externalBalance += amount;

  log.push({
    date,
    type: "income",
    message: `${partnerName(partner, state.household)} income landed in ${account}: ${currency(amount)}.`,
  });
}

function applyLeftoverRule(state, partner, startingExternalBalance, date, log) {
  const rule = partner === "partnerA" ? state.household.partnerALeftoverRule : state.household.partnerBLeftoverRule;
  const flow = partner === "partnerA" ? state.household.partnerAFlow : state.household.partnerBFlow;
  const usesExternal = flow === "bills" || flow === "mortgage" || flow === "mortgage_bills" || flow === "joint_bills";
  if (!usesExternal) return;

  const leftover = Math.max(0, Number(state.household.externalBalance || 0) - Number(startingExternalBalance || 0));
  if (leftover <= 0) return;

  if (rule === "transfer_offset") {
    state.household.externalBalance -= leftover;
    state.household.offsetBalance += leftover;
    log.push({
      date,
      type: "leftover",
      message: `${partnerName(partner, state.household)} leftover swept to offset: ${currency(leftover)}.`,
    });
  }

  if (rule === "forgotten") {
    state.household.externalBalance -= leftover;
    log.push({
      date,
      type: "leftover",
      message: `${partnerName(partner, state.household)} leftover was forgotten and resets next pay: ${currency(leftover)}.`,
    });
  }
}

function logPaidBills(beforeArchive, afterArchive, date, log) {
  const added = afterArchive.slice(0, Math.max(0, afterArchive.length - beforeArchive.length));
  added.reverse().forEach((item) => {
    const split = item.payments?.length
      ? item.payments.map((payment) => `${payment.partner || payment.account} ${currency(payment.amount)}`).join(", ")
      : item.account;
    log.push({
      date,
      type: "paid",
      message: `${item.name} paid by ${item.coveredBy || item.account}: ${currency(item.amount)}. Split: ${split}.`,
    });
  });
}

function logOpenDueBills(state, date, log) {
  state.bills
    .filter((bill) => bill.status === "active")
    .filter((bill) => bill.nextDueDate && bill.nextDueDate <= date)
    .forEach((bill) => {
      log.push({
        date,
        type: "open",
        message: `${bill.name} stayed open. Remaining: ${currency(getBillAmountRemaining(bill))}.`,
      });
    });
}

export function createSimulationState({ household, bills, archive, today }) {
  return {
    currentDate: today,
    startingExternalBalance: Number(household.externalBalance || 0),
    household: clone(household),
    bills: clone(bills),
    archive: clone(archive),
    log: [{ date: today, type: "start", message: `Simulation started at ${shortDate(today)}. Live data was cloned.` }],
  };
}

export function simulateToDate(simulation, targetDate) {
  let state = clone(simulation);
  const log = [...state.log];
  let cursor = state.currentDate;

  while (cursor < targetDate) {
    cursor = addDays(cursor, 1);
    const paydayA = isPayday(state.household.nextPaydayA, cursor);
    const paydayB = isPayday(state.household.nextPaydayB, cursor);

    if (paydayA) addIncome(state, "partnerA", cursor, log);
    if (paydayB) addIncome(state, "partnerB", cursor, log);

    const beforeArchive = [...state.archive];
    state = { ...state, ...autoAssumePaid(state, cursor) };
    logPaidBills(beforeArchive, state.archive, cursor, log);

    if (paydayA) applyLeftoverRule(state, "partnerA", simulation.startingExternalBalance, cursor, log);
    if (paydayB) applyLeftoverRule(state, "partnerB", simulation.startingExternalBalance, cursor, log);

    logOpenDueBills(state, cursor, log);
  }

  return {
    ...state,
    currentDate: targetDate,
    log,
  };
}

export function findNextGate(simulation) {
  const candidates = [];

  ["partnerA", "partnerB"].forEach((partner) => {
    const payday = partner === "partnerA" ? simulation.household.nextPaydayA : simulation.household.nextPaydayB;
    if (!payday) return;
    let next = payday;
    while (next <= simulation.currentDate) next = addDays(next, 14);
    candidates.push(next);
  });

  simulation.bills.forEach((bill) => {
    if (bill.nextDueDate && bill.nextDueDate > simulation.currentDate) candidates.push(bill.nextDueDate);
  });

  return candidates.sort()[0] || addDays(simulation.currentDate, 14);
}

export function addTestBill(simulation) {
  const nextDate = addDays(simulation.currentDate, 7);
  return {
    ...simulation,
    bills: [
      {
        id: `sim-bill-${Date.now()}`,
        name: "Simulation bill",
        amount: 750,
        category: "Test",
        frequency: "once",
        startDate: nextDate,
        nextDueDate: nextDate,
        finishDate: nextDate,
        whoPays: "joint",
        accountRule: "auto",
        status: "active",
        amountCovered: 0,
      },
      ...simulation.bills,
    ],
    log: [
      { date: simulation.currentDate, type: "added", message: `Added test bill due ${shortDate(nextDate)} for ${currency(750)}.` },
      ...simulation.log,
    ],
  };
}

export function summarizeSimulation(simulation) {
  return {
    externalBalance: simulation.household.externalBalance,
    offsetBalance: simulation.household.offsetBalance,
    openAlerts: getOpenAlerts(simulation.bills).length,
    openDueBills: simulation.bills.filter((bill) => bill.status === "active" && bill.nextDueDate && bill.nextDueDate <= simulation.currentDate).length,
    paidCount: simulation.archive.length,
  };
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

export function buildAuditWorkbook(simulation) {
  const loan = calculateLoanMetrics(simulation.household);
  return {
    auditLog: toCsv(simulation.log.map((entry) => ({
      date: entry.date,
      type: entry.type,
      message: entry.message,
      externalBalance: simulation.household.externalBalance,
      offsetBalance: simulation.household.offsetBalance,
    }))),
    billLedger: toCsv(simulation.bills.map((bill) => ({
      name: bill.name,
      amount: bill.amount,
      category: bill.category,
      frequency: bill.frequency,
      nextDueDate: bill.nextDueDate,
      status: bill.status,
      accountRule: bill.accountRule,
      whoPays: bill.whoPays,
      amountCovered: bill.amountCovered,
    }))),
    paidArchive: toCsv(simulation.archive.map((item) => ({
      paidDate: item.paidDate,
      name: item.name,
      amount: item.amount,
      account: item.account,
      coveredBy: item.coveredBy,
      paymentSplit: item.payments?.map((payment) => `${payment.partner || payment.account}:${payment.amount}`).join("; "),
      category: item.category,
    }))),
    loanDetails: toCsv([{
      loanMode: simulation.household.loanMode,
      totalLoanBalance: loan.totalBalance,
      fixedBalance: simulation.household.fixedBalance,
      fixedRate: simulation.household.fixedRate,
      variableBalance: simulation.household.variableBalance,
      variableRate: simulation.household.variableRate,
      weightedRate: loan.weightedRate,
      dailyGrossInterest: loan.dailyGrossInterest,
      offsetCredit: loan.offsetCredit,
      dailyNetInterest: loan.dailyNetInterest,
      monthlyInterest: loan.monthlyInterest,
      yearlyInterest: loan.yearlyInterest,
    }]),
  };
}
