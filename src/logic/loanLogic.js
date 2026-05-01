import { addDays, addMonthsClamped, daysBetween } from "./financeCalculations.js";

const DEFAULT_REPAYMENT_FREQUENCY = "fortnightly";
const DEFAULT_RECONCILIATION_FREQUENCY = "weekly";

const DEFAULT_FIXED_TERM_YEARS = 2;
const FIXED_END_WARNING_DAYS = 90;
const TOP_UP_WARNING_DAYS = 90;

function numberOrFallback(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLoanActivity(activity = [], today = "2026-04-29") {
  return (Array.isArray(activity) ? activity : [])
    .filter(Boolean)
    .map((event, index) => ({
      id: event.id || `loan-activity-${event.date || today}-${event.type || "event"}-${index}`,
      date: event.date || today,
      type: event.type || "note",
      title: event.title || "Loan activity",
      detail: event.detail || "",
      amount: event.amount === undefined || event.amount === "" ? "" : Number(event.amount || 0),
      source: event.source || "",
      targetSplit: event.targetSplit || "",
      confirmed: Boolean(event.confirmed),
      reversible: event.reversible !== undefined ? Boolean(event.reversible) : event.type === "extra_repayment",
      impact: event.impact || null,
      createdAt: event.createdAt || new Date().toISOString(),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function appendLoanActivity(state, event, today = "2026-04-29") {
  state.loan = state.loan || {};
  const idBase = `${event.type || "event"}-${event.date || today}-${Math.round(Number(event.amount || 0) * 100)}`;
  state.loan.activity = normalizeLoanActivity([
    {
      id: event.id || `${idBase}-${Date.now()}`,
      date: event.date || today,
      createdAt: event.createdAt || new Date().toISOString(),
      ...event,
    },
    ...(state.loan.activity || []),
  ], today);
  return state;
}

function getDefaultFixedEndDate(startDate, termYears = DEFAULT_FIXED_TERM_YEARS) {
  return addMonthsClamped(startDate, numberOrFallback(termYears, DEFAULT_FIXED_TERM_YEARS) * 12);
}

function normaliseFixedConfig(fixed = {}, today) {
  const fixedTermYears = numberOrFallback(fixed.fixedTermYears, DEFAULT_FIXED_TERM_YEARS) || DEFAULT_FIXED_TERM_YEARS;
  const fixedStartDate = fixed.fixedStartDate || today;
  const fixedEndDate = fixed.fixedEndDate || getDefaultFixedEndDate(fixedStartDate, fixedTermYears);
  const info = getFixedRolloverInfo({ mode: "split", fixed: { ...fixed, fixedEndDate } }, today);
  return {
    ...fixed,
    fixedStartDate,
    fixedEndDate,
    fixedTermYears,
    status: fixed.status === "rolled_to_variable" ? "rolled_to_variable" : info.status,
  };
}

export function getFixedRolloverInfo(loan = {}, today = "2026-04-29") {
  const fixed = loan.fixed || {};
  const fixedBalance = Number(fixed.balance || 0);
  const fixedEndDate = fixed.fixedEndDate || "";

  if (loan.mode !== "split" || !fixedEndDate) {
    return { applies: false, status: "not_set", daysRemaining: null, due: false, warning: false, message: "" };
  }

  if (fixed.status === "rolled_to_variable" || fixedBalance <= 0) {
    return { applies: true, status: "rolled_to_variable", daysRemaining: null, due: false, warning: false, message: "Fixed split has rolled into variable." };
  }

  const daysRemaining = daysBetween(today, fixedEndDate);
  if (daysRemaining <= 0) {
    return {
      applies: true,
      status: "expired",
      daysRemaining,
      due: true,
      warning: true,
      message: "Fixed rate period has ended. Confirm the new variable rate and repayment from your bank.",
    };
  }

  if (daysRemaining <= FIXED_END_WARNING_DAYS) {
    return {
      applies: true,
      status: "ending_soon",
      daysRemaining,
      due: false,
      warning: true,
      message: `Fixed split ends in ${daysRemaining} days. It is expected to roll into variable on ${fixedEndDate}.`,
    };
  }

  return {
    applies: true,
    status: "active",
    daysRemaining,
    due: false,
    warning: false,
    message: `Fixed split ends on ${fixedEndDate}.`,
  };
}

export function getFixedRolloverLabel(info = {}) {
  if (info.status === "rolled_to_variable") return "rolled to variable";
  if (info.status === "expired") return "ended — confirm bank details";
  if (info.status === "ending_soon") return `ends in ${info.daysRemaining} days`;
  if (info.status === "active") return `ends in ${info.daysRemaining} days`;
  return "not set";
}

export function applyFixedRateRollover(state, today = "2026-04-29") {
  const next = structuredClone(state);
  const loan = next.loan || {};
  if (loan.mode !== "split" || !loan.fixed) return next;

  const fixedInfo = getFixedRolloverInfo(loan, today);
  const rolloverEnabled = loan.fixedRollover?.enabled !== false;
  const fixedBalance = Number(loan.fixed?.balance || 0);
  if (!rolloverEnabled || !fixedInfo.due || fixedBalance <= 0) {
    next.loan.fixed = { ...next.loan.fixed, status: loan.fixed?.status === "rolled_to_variable" ? "rolled_to_variable" : fixedInfo.status };
    return next;
  }

  const fixedConfirmed = Number(loan.fixed?.confirmedBalance ?? fixedBalance);
  const variableBalance = Number(loan.variable?.balance || 0);
  const variableConfirmed = Number(loan.variable?.confirmedBalance ?? variableBalance);

  next.loan.variable = {
    ...loan.variable,
    balance: variableBalance + fixedBalance,
    confirmedBalance: variableConfirmed + fixedConfirmed,
    repaymentAmount: Number(loan.variable?.repaymentAmount || 0) + Number(loan.fixed?.repaymentAmount || 0),
  };
  next.loan.fixed = {
    ...loan.fixed,
    balance: 0,
    confirmedBalance: 0,
    repaymentAmount: 0,
    status: "rolled_to_variable",
    rolledDate: today,
  };
  next.loan.totalBalance = Number(next.loan.variable.balance || 0);
  next.loan.fixedRollover = {
    ...(loan.fixedRollover || {}),
    enabled: true,
    rolloverDate: loan.fixed.fixedEndDate,
    rolloverBehaviour: "merge_into_variable",
    reviewed: false,
  };
  next.loan.balanceStatus = "needs_check";
  next.loan.nextReconciliationDate = today;
  next.loan.lastRolloverDate = today;
  next.loan.lastRolloverMessage = "Fixed split was automatically moved into the variable split. Confirm the new bank rate and repayment when available.";
  appendLoanActivity(next, {
    type: "fixed_rollover",
    title: "Fixed split rolled into variable",
    detail: "Remaining fixed balance moved into the variable split. Confirm the new rate and repayment from the bank.",
    amount: fixedBalance,
    targetSplit: "variable",
    confirmed: false,
  }, today);
  return next;
}

export function getRepaymentPeriodDays(frequency = DEFAULT_REPAYMENT_FREQUENCY) {
  if (frequency === "weekly") return 7;
  if (frequency === "monthly") return 30.4375;
  return 14;
}

export function getNextBalanceCheckDate(fromDate, frequency = DEFAULT_RECONCILIATION_FREQUENCY) {
  return addDays(fromDate, frequency === "fortnightly" ? 14 : 7);
}

export function getMortgageRepaymentAmount(loan = {}) {
  if (loan.mode === "split") {
    const fixed = Number(loan.fixed?.repaymentAmount || 0);
    const variable = Number(loan.variable?.repaymentAmount || 0);
    if (fixed + variable > 0) return fixed + variable;
  }
  return Number(loan.repayment || 0);
}

export function getWorkingLoanTotal(loan = {}) {
  if (loan.mode === "single") return Number(loan.single?.balance ?? loan.totalBalance ?? 0);
  return Number(loan.fixed?.balance || 0) + Number(loan.variable?.balance || 0);
}

export function getConfirmedLoanTotal(loan = {}) {
  if (loan.mode === "single") return Number(loan.single?.confirmedBalance ?? loan.single?.balance ?? loan.totalBalance ?? 0);
  return Number(loan.fixed?.confirmedBalance ?? loan.fixed?.balance ?? 0) + Number(loan.variable?.confirmedBalance ?? loan.variable?.balance ?? 0);
}

export function getLoanStatusLabel(status) {
  if (status === "confirmed") return "confirmed";
  if (status === "needs_check") return "check due";
  if (status === "out_of_sync") return "out of sync";
  return "estimated";
}

export function isBalanceCheckDue(state, today) {
  return Boolean(state?.loan?.nextReconciliationDate && state.loan.nextReconciliationDate <= today);
}

function getRepaymentAllocation(loan = {}) {
  const totalRepayment = getMortgageRepaymentAmount(loan);

  if (loan.mode === "single") {
    return {
      mode: "single",
      single: totalRepayment,
      totalRepayment,
      allocationMode: "single",
    };
  }

  const explicitFixed = Number(loan.fixed?.repaymentAmount || 0);
  const explicitVariable = Number(loan.variable?.repaymentAmount || 0);
  if (explicitFixed + explicitVariable > 0) {
    return {
      mode: "split",
      fixed: explicitFixed,
      variable: explicitVariable,
      totalRepayment: explicitFixed + explicitVariable,
      allocationMode: "split repayment amounts",
    };
  }

  const fixedBalance = Number(loan.fixed?.balance || 0);
  const variableBalance = Number(loan.variable?.balance || 0);
  const totalBalance = fixedBalance + variableBalance;

  if (totalBalance <= 0) {
    return {
      mode: "split",
      fixed: totalRepayment / 2,
      variable: totalRepayment / 2,
      totalRepayment,
      allocationMode: "proportional estimate",
    };
  }

  return {
    mode: "split",
    fixed: totalRepayment * (fixedBalance / totalBalance),
    variable: totalRepayment * (variableBalance / totalBalance),
    totalRepayment,
    allocationMode: "proportional estimate",
  };
}

function estimatePart({ balance, rate, repaymentAmount, periodDays, offsetBalance = 0 }) {
  const startingBalance = Number(balance || 0);
  const interestBase = Math.max(0, startingBalance - Number(offsetBalance || 0));
  const estimatedInterest = (interestBase * Number(rate || 0)) / 100 / 365 * periodDays;
  const principalPaid = Number(repaymentAmount || 0) - estimatedInterest;
  const principalReduction = Math.max(0, principalPaid);

  return {
    startingBalance,
    interestBase,
    repaymentAmount: Number(repaymentAmount || 0),
    estimatedInterest,
    principalPaid,
    principalReduction,
    endingBalance: Math.max(0, startingBalance - principalReduction),
    underpayingInterest: principalPaid < 0,
  };
}

export function estimateMortgageRepayment(loan = {}, offsetBalance = 0) {
  const periodDays = getRepaymentPeriodDays(loan.repaymentFrequency);
  const allocation = getRepaymentAllocation(loan);

  if (loan.mode === "single") {
    const single = estimatePart({
      balance: loan.single?.balance ?? loan.totalBalance,
      rate: loan.single?.rate,
      repaymentAmount: allocation.single,
      periodDays,
      offsetBalance,
    });
    return {
      mode: "single",
      periodDays,
      allocationMode: allocation.allocationMode,
      totalRepayment: allocation.totalRepayment,
      totalInterest: single.estimatedInterest,
      totalPrincipal: single.principalReduction,
      underpayingInterest: single.underpayingInterest,
      single,
    };
  }

  const fixed = estimatePart({
    balance: loan.fixed?.balance,
    rate: loan.fixed?.rate,
    repaymentAmount: allocation.fixed,
    periodDays,
    offsetBalance: 0,
  });
  const variable = estimatePart({
    balance: loan.variable?.balance,
    rate: loan.variable?.rate,
    repaymentAmount: allocation.variable,
    periodDays,
    offsetBalance,
  });

  return {
    mode: "split",
    periodDays,
    allocationMode: allocation.allocationMode,
    totalRepayment: allocation.totalRepayment,
    totalInterest: fixed.estimatedInterest + variable.estimatedInterest,
    totalPrincipal: fixed.principalReduction + variable.principalReduction,
    underpayingInterest: fixed.underpayingInterest || variable.underpayingInterest,
    fixed,
    variable,
  };
}


function normalizeTopUp(topUp = {}, index = 0, today = "2026-04-29") {
  const amount = Math.max(0, numberOrFallback(topUp.amount ?? topUp.topUpAmount, 0));
  const id = topUp.id || `topup-${today}-${index}-${amount}`;
  const destinationAccount = topUp.destinationAccount || "offset";
  return {
    id,
    expectedDate: topUp.expectedDate || topUp.date || today,
    amount,
    targetSplit: topUp.targetSplit || "variable",
    destinationAccount: destinationAccount === "external" ? "external" : "offset",
    newVariableRate: topUp.newVariableRate ?? "",
    newRepaymentAmount: topUp.newRepaymentAmount ?? "",
    status: topUp.status || "planned",
    note: topUp.note || topUp.reason || "",
    createdDate: topUp.createdDate || today,
    confirmedDate: topUp.confirmedDate || "",
    confirmedAmount: topUp.confirmedAmount ?? "",
    fundsReceived: topUp.fundsReceived ?? "",
    confirmedVariableBalance: topUp.confirmedVariableBalance ?? "",
    confirmedDestinationBalance: topUp.confirmedDestinationBalance ?? "",
    cancelledDate: topUp.cancelledDate || "",
  };
}

export function normalizeLoanTopUps(topUps = [], today = "2026-04-29") {
  return (Array.isArray(topUps) ? topUps : [])
    .map((topUp, index) => normalizeTopUp(topUp, index, today))
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "planned") return -1;
        if (b.status === "planned") return 1;
      }
      return String(a.expectedDate).localeCompare(String(b.expectedDate));
    });
}

export function getActiveLoanTopUps(loan = {}) {
  return normalizeLoanTopUps(loan.topUps || []).filter((topUp) => topUp.status === "planned");
}

export function getLoanTopUpsDueInWindow(state = {}, today = "2026-04-29", days = 7) {
  const endDate = addDays(today, days);
  return getActiveLoanTopUps(state.loan || {}).filter((topUp) => topUp.expectedDate >= today && topUp.expectedDate <= endDate);
}

export function getLoanTopUpAlerts(state = {}, today = "2026-04-29") {
  const active = getActiveLoanTopUps(state.loan || {});
  const alerts = [];
  active.forEach((topUp) => {
    const daysUntil = daysBetween(today, topUp.expectedDate);
    if (daysUntil < 0) {
      alerts.push({
        id: topUp.id,
        priority: 1,
        type: "overdue_top_up",
        topUp,
        daysUntil,
        message: "Planned variable loan top-up may need confirmation.",
        action: "Confirm or cancel the planned variable loan top-up.",
      });
    } else if (daysUntil <= TOP_UP_WARNING_DAYS) {
      alerts.push({
        id: topUp.id,
        priority: daysUntil <= 14 ? 2 : 4,
        type: "upcoming_top_up",
        topUp,
        daysUntil,
        message: `Planned variable loan top-up is ${daysUntil === 0 ? "due today" : `due in ${daysUntil} days`}.`,
        action: "Check the expected top-up amount, destination account, new rate and repayment.",
      });
    }
  });
  return alerts.sort((a, b) => a.priority - b.priority || a.daysUntil - b.daysUntil);
}

export function getTopUpProjectedImpact(state = {}, topUp = {}) {
  const amount = Number(topUp.amount || 0);
  const variableBalance = Number(state.loan?.variable?.balance || 0);
  const offsetBalance = Number(state.accounts?.offset?.balance || 0);
  const externalBalance = Number(state.accounts?.externalBalance || 0);
  return {
    plannedVariableBalance: variableBalance + amount,
    plannedOffsetBalance: topUp.destinationAccount === "offset" ? offsetBalance + amount : offsetBalance,
    plannedExternalBalance: topUp.destinationAccount === "external" ? externalBalance + amount : externalBalance,
    amount,
  };
}

export function addVariableLoanTopUp(state, values = {}, today = "2026-04-29") {
  const next = structuredClone(state);
  const amount = Math.max(0, numberOrFallback(values.amount, 0));
  if (amount <= 0) return next;
  const topUp = normalizeTopUp({
    ...values,
    id: values.id || `topup-variable-${values.expectedDate || today}-${amount}-${(next.loan.topUps || []).length + 1}`,
    amount,
    targetSplit: "variable",
    status: "planned",
    createdDate: today,
  }, 0, today);
  next.loan.topUps = normalizeLoanTopUps([...(next.loan.topUps || []), topUp], today);
  appendLoanActivity(next, {
    type: "top_up_planned",
    title: "Variable top-up planned",
    detail: `Expected ${topUp.expectedDate} · funds to ${topUp.destinationAccount === "offset" ? "offset" : "bills account"}.`,
    amount,
    targetSplit: "variable",
    confirmed: false,
  }, today);
  return next;
}

export function cancelVariableLoanTopUp(state, topUpId, today = "2026-04-29") {
  const next = structuredClone(state);
  const topUps = normalizeLoanTopUps(next.loan.topUps || [], today);
  const target = topUps.find((topUp) => topUp.id === topUpId);
  next.loan.topUps = topUps.map((topUp) =>
    topUp.id === topUpId
      ? { ...topUp, status: "cancelled", cancelledDate: today }
      : topUp,
  );
  if (target) {
    appendLoanActivity(next, {
      type: "top_up_cancelled",
      title: "Variable top-up cancelled",
      detail: `Cancelled planned top-up for ${target.expectedDate}.`,
      amount: target.amount,
      targetSplit: "variable",
      confirmed: true,
    }, today);
  }
  return next;
}

function valueOrFallback(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return Number(value);
}

export function confirmVariableLoanTopUp(state, topUpId, values = {}, today = "2026-04-29") {
  const next = structuredClone(state);
  const topUps = normalizeLoanTopUps(next.loan.topUps || [], today);
  const target = topUps.find((topUp) => topUp.id === topUpId);
  if (!target) return next;

  const confirmedAmount = Math.max(0, valueOrFallback(values.confirmedAmount, target.amount));
  const fundsReceived = Math.max(0, valueOrFallback(values.fundsReceived, confirmedAmount));
  const destinationAccount = values.destinationAccount || target.destinationAccount || "offset";
  const currentVariable = Number(next.loan.variable?.balance || 0);
  const confirmedVariableBalance = Math.max(0, valueOrFallback(values.variableBalance, currentVariable + confirmedAmount));
  const nextRate = valueOrFallback(values.newVariableRate, valueOrFallback(target.newVariableRate, next.loan.variable?.rate || 0));
  const nextRepayment = valueOrFallback(values.newRepaymentAmount, valueOrFallback(target.newRepaymentAmount, next.loan.variable?.repaymentAmount || 0));

  next.loan.variable = {
    ...(next.loan.variable || {}),
    balance: confirmedVariableBalance,
    confirmedBalance: confirmedVariableBalance,
    rate: Number.isFinite(nextRate) && nextRate > 0 ? nextRate : Number(next.loan.variable?.rate || 0),
    repaymentAmount: Number.isFinite(nextRepayment) && nextRepayment > 0 ? nextRepayment : Number(next.loan.variable?.repaymentAmount || 0),
  };
  next.loan.totalBalance = Number(next.loan.fixed?.balance || 0) + Number(next.loan.variable?.balance || 0);
  next.loan.balanceStatus = "confirmed";
  next.loan.lastConfirmedDate = today;
  next.loan.nextReconciliationDate = getNextBalanceCheckDate(today, next.loan.reconciliationFrequency || DEFAULT_RECONCILIATION_FREQUENCY);

  let confirmedDestinationBalance = "";
  if (destinationAccount === "external") {
    const currentExternal = Number(next.accounts.externalBalance || 0);
    confirmedDestinationBalance = Math.max(0, valueOrFallback(values.externalBalance, currentExternal + fundsReceived));
    next.accounts.externalBalance = confirmedDestinationBalance;
  } else {
    const currentOffset = Number(next.accounts.offset?.balance || 0);
    confirmedDestinationBalance = Math.max(0, valueOrFallback(values.offsetBalance, currentOffset + fundsReceived));
    next.accounts.offset = {
      ...(next.accounts.offset || {}),
      balance: confirmedDestinationBalance,
      confirmedBalance: confirmedDestinationBalance,
      lastConfirmedDate: today,
      balanceStatus: "confirmed",
    };
  }

  next.loan.topUps = topUps.map((topUp) =>
    topUp.id === topUpId
      ? {
          ...topUp,
          status: "confirmed",
          confirmedDate: today,
          confirmedAmount,
          fundsReceived,
          destinationAccount,
          confirmedVariableBalance,
          confirmedDestinationBalance,
          newVariableRate: Number.isFinite(nextRate) && nextRate > 0 ? nextRate : topUp.newVariableRate,
          newRepaymentAmount: Number.isFinite(nextRepayment) && nextRepayment > 0 ? nextRepayment : topUp.newRepaymentAmount,
        }
      : topUp,
  );

  appendLoanActivity(next, {
    type: "top_up_confirmed",
    title: "Variable top-up confirmed",
    detail: `Variable balance confirmed at ${confirmedVariableBalance.toFixed(2)}; funds landed in ${destinationAccount === "offset" ? "offset" : "bills account"}.`,
    amount: confirmedAmount,
    targetSplit: "variable",
    source: destinationAccount,
    confirmed: true,
  }, today);

  return next;
}

export function applyEstimatedMortgageRepayment(state, paidDate) {
  const next = applyFixedRateRollover(state, paidDate);
  const estimate = estimateMortgageRepayment(next.loan, next.accounts?.offset?.balance || 0);

  if (next.loan.mode === "single") {
    next.loan.single = {
      ...next.loan.single,
      balance: estimate.single.endingBalance,
      confirmedBalance: Number(next.loan.single?.confirmedBalance ?? estimate.single.startingBalance),
    };
    next.loan.totalBalance = estimate.single.endingBalance;
  } else {
    next.loan.fixed = {
      ...next.loan.fixed,
      balance: estimate.fixed.endingBalance,
      confirmedBalance: Number(next.loan.fixed?.confirmedBalance ?? estimate.fixed.startingBalance),
    };
    next.loan.variable = {
      ...next.loan.variable,
      balance: estimate.variable.endingBalance,
      confirmedBalance: Number(next.loan.variable?.confirmedBalance ?? estimate.variable.startingBalance),
    };
    next.loan.totalBalance = estimate.fixed.endingBalance + estimate.variable.endingBalance;
  }

  next.loan.balanceStatus = estimate.underpayingInterest ? "out_of_sync" : "estimated";
  next.loan.lastEstimatedDate = paidDate;
  next.loan.lastEstimate = {
    date: paidDate,
    periodDays: estimate.periodDays,
    allocationMode: estimate.allocationMode,
    totalRepayment: estimate.totalRepayment,
    estimatedInterest: estimate.totalInterest,
    estimatedPrincipal: estimate.totalPrincipal,
    underpayingInterest: estimate.underpayingInterest,
  };

  appendLoanActivity(next, {
    type: "mortgage_repayment",
    title: "Mortgage repayment estimated",
    detail: `Principal ${estimate.totalPrincipal.toFixed(2)} · interest ${estimate.totalInterest.toFixed(2)} · ${estimate.allocationMode}.`,
    amount: estimate.totalRepayment,
    targetSplit: estimate.mode,
    confirmed: false,
  }, paidDate);

  return { state: next, estimate };
}

export function reconcileMortgageBalances(state, values, today) {
  const next = structuredClone(state);
  const frequency = next.loan.reconciliationFrequency || DEFAULT_RECONCILIATION_FREQUENCY;

  if (next.loan.mode === "single") {
    const singleBalance = Number(values.singleBalance ?? next.loan.single?.balance ?? 0);
    next.loan.single = {
      ...next.loan.single,
      balance: singleBalance,
      confirmedBalance: singleBalance,
    };
    next.loan.totalBalance = singleBalance;
  } else {
    const fixedBalance = Number(values.fixedBalance ?? next.loan.fixed?.balance ?? 0);
    const variableBalance = Number(values.variableBalance ?? next.loan.variable?.balance ?? 0);
    const fixedRate = values.fixedRate === undefined || values.fixedRate === "" ? next.loan.fixed?.rate : Number(values.fixedRate);
    const variableRate = values.variableRate === undefined || values.variableRate === "" ? next.loan.variable?.rate : Number(values.variableRate);
    const fixedEndDate = values.fixedEndDate || next.loan.fixed?.fixedEndDate;
    const fixedStartDate = values.fixedStartDate || next.loan.fixed?.fixedStartDate;
    const fixedTermYears = values.fixedTermYears === undefined || values.fixedTermYears === "" ? next.loan.fixed?.fixedTermYears : Number(values.fixedTermYears);
    next.loan.fixed = {
      ...next.loan.fixed,
      balance: fixedBalance,
      confirmedBalance: fixedBalance,
      rate: numberOrFallback(fixedRate, next.loan.fixed?.rate || 0),
      fixedStartDate,
      fixedEndDate,
      fixedTermYears: numberOrFallback(fixedTermYears, next.loan.fixed?.fixedTermYears || DEFAULT_FIXED_TERM_YEARS),
    };
    const fixedInfo = getFixedRolloverInfo(next.loan, today);
    next.loan.fixed.status = next.loan.fixed.status === "rolled_to_variable" ? "rolled_to_variable" : fixedInfo.status;
    next.loan.variable = {
      ...next.loan.variable,
      balance: variableBalance,
      confirmedBalance: variableBalance,
      rate: numberOrFallback(variableRate, next.loan.variable?.rate || 0),
    };
    next.loan.totalBalance = fixedBalance + variableBalance;
  }

  const offsetBalance = Number(values.offsetBalance ?? next.accounts.offset.balance ?? 0);
  next.accounts.offset = {
    ...next.accounts.offset,
    balance: offsetBalance,
    confirmedBalance: offsetBalance,
    lastConfirmedDate: today,
    balanceStatus: "confirmed",
  };

  next.loan.lastConfirmedDate = today;
  next.loan.nextReconciliationDate = getNextBalanceCheckDate(today, frequency);
  next.loan.fixedRollover = {
    ...(next.loan.fixedRollover || {}),
    enabled: next.loan.fixedRollover?.enabled !== false,
    rolloverDate: next.loan.fixed?.fixedEndDate || next.loan.fixedRollover?.rolloverDate || "",
    rolloverBehaviour: next.loan.fixedRollover?.rolloverBehaviour || "merge_into_variable",
    reviewed: next.loan.fixed?.status === "rolled_to_variable" ? true : Boolean(next.loan.fixedRollover?.reviewed),
  };
  if (next.loan.fixed?.status === "rolled_to_variable") next.loan.lastRolloverMessage = "";
  next.loan.balanceStatus = "confirmed";
  appendLoanActivity(next, {
    type: "balance_check",
    title: "Loan and offset balances checked",
    detail: next.loan.mode === "split" ? "Fixed, variable and offset balances were confirmed from the bank." : "Loan and offset balances were confirmed from the bank.",
    amount: getWorkingLoanTotal(next.loan),
    targetSplit: next.loan.mode,
    confirmed: true,
  }, today);
  return next;
}

export function recordExtraLoanRepayment(state, values = {}, today = "2026-04-29") {
  const next = structuredClone(state);
  const amount = Math.max(0, numberOrFallback(values.amount, 0));
  if (amount <= 0) return next;

  const fromAccount = values.fromAccount || "offset";
  const bankConfirmed = Boolean(values.bankConfirmed ?? values.confirmed);
  const targetSplit = values.targetSplit || (next.loan.mode === "split" ? "variable" : "single");
  const note = values.note || "";

  if (fromAccount === "offset") {
    const currentOffset = Number(next.accounts.offset?.balance || 0);
    const nextOffset = Math.max(0, currentOffset - amount);
    next.accounts.offset = {
      ...(next.accounts.offset || {}),
      balance: nextOffset,
      confirmedBalance: bankConfirmed ? nextOffset : Number(next.accounts.offset?.confirmedBalance ?? currentOffset),
      lastConfirmedDate: bankConfirmed ? today : next.accounts.offset?.lastConfirmedDate,
      balanceStatus: bankConfirmed ? "confirmed" : "estimated",
    };
  } else if (fromAccount === "external") {
    next.accounts.externalBalance = Math.max(0, Number(next.accounts.externalBalance || 0) - amount);
  }

  const reduce = (splitKey, requestedAmount) => {
    const current = Number(next.loan[splitKey]?.balance || 0);
    const reduction = Math.min(current, Math.max(0, Number(requestedAmount || 0)));
    const newBalance = Math.max(0, current - reduction);
    next.loan[splitKey] = {
      ...(next.loan[splitKey] || {}),
      balance: newBalance,
      confirmedBalance: bankConfirmed ? newBalance : Number(next.loan[splitKey]?.confirmedBalance ?? current),
    };
    return reduction;
  };

  let fixedReduction = 0;
  let variableReduction = 0;
  let singleReduction = 0;

  if (next.loan.mode === "single") {
    singleReduction = reduce("single", amount);
    next.loan.totalBalance = Number(next.loan.single?.balance || 0);
  } else if (targetSplit === "fixed") {
    fixedReduction = reduce("fixed", amount);
    next.loan.totalBalance = Number(next.loan.fixed?.balance || 0) + Number(next.loan.variable?.balance || 0);
  } else if (targetSplit === "split") {
    const fixedBalance = Number(next.loan.fixed?.balance || 0);
    const variableBalance = Number(next.loan.variable?.balance || 0);
    const totalBalance = fixedBalance + variableBalance;
    const fixedShare = totalBalance > 0 ? amount * (fixedBalance / totalBalance) : amount / 2;
    fixedReduction = reduce("fixed", fixedShare);
    variableReduction = reduce("variable", amount - fixedReduction);
    next.loan.totalBalance = Number(next.loan.fixed?.balance || 0) + Number(next.loan.variable?.balance || 0);
  } else {
    variableReduction = reduce("variable", amount);
    next.loan.totalBalance = Number(next.loan.fixed?.balance || 0) + Number(next.loan.variable?.balance || 0);
  }

  if (bankConfirmed) {
    next.loan.balanceStatus = "confirmed";
    next.loan.lastConfirmedDate = today;
    next.loan.nextReconciliationDate = getNextBalanceCheckDate(today, next.loan.reconciliationFrequency || DEFAULT_RECONCILIATION_FREQUENCY);
  } else {
    next.loan.balanceStatus = "estimated";
    next.loan.lastEstimatedDate = today;
  }

  const actualReduction = fixedReduction + variableReduction + singleReduction;
  appendLoanActivity(next, {
    type: "extra_repayment",
    title: "Extra loan repayment recorded",
    detail: `${fromAccount === "offset" ? "Offset" : fromAccount === "external" ? "Bills account" : "Untracked account"} paid extra to ${targetSplit}${note ? ` · ${note}` : ""}.`,
    amount: actualReduction,
    source: fromAccount,
    targetSplit,
    confirmed: bankConfirmed,
    reversible: true,
    impact: {
      fromAccount,
      targetSplit,
      requestedAmount: amount,
      actualReduction,
      fixedReduction,
      variableReduction,
      singleReduction,
      offsetReduction: fromAccount === "offset" ? amount : 0,
      externalReduction: fromAccount === "external" ? amount : 0,
      bankConfirmed,
    },
  }, values.date || today);

  return next;
}

function applyBalanceDeltaForActivity(next, event, direction = 1) {
  const impact = event?.impact || {};
  const confirmed = Boolean(impact.bankConfirmed ?? event.confirmed);
  const fixedDelta = Number(impact.fixedReduction || 0) * direction;
  const variableDelta = Number(impact.variableReduction || 0) * direction;
  const singleDelta = Number(impact.singleReduction || 0) * direction;
  const offsetDelta = Number(impact.offsetReduction || 0) * direction;
  const externalDelta = Number(impact.externalReduction || 0) * direction;

  if (fixedDelta) {
    next.loan.fixed.balance = Math.max(0, Number(next.loan.fixed?.balance || 0) + fixedDelta);
    if (confirmed) next.loan.fixed.confirmedBalance = Math.max(0, Number(next.loan.fixed?.confirmedBalance || 0) + fixedDelta);
  }
  if (variableDelta) {
    next.loan.variable.balance = Math.max(0, Number(next.loan.variable?.balance || 0) + variableDelta);
    if (confirmed) next.loan.variable.confirmedBalance = Math.max(0, Number(next.loan.variable?.confirmedBalance || 0) + variableDelta);
  }
  if (singleDelta) {
    next.loan.single.balance = Math.max(0, Number(next.loan.single?.balance || 0) + singleDelta);
    if (confirmed) next.loan.single.confirmedBalance = Math.max(0, Number(next.loan.single?.confirmedBalance || 0) + singleDelta);
  }
  if (offsetDelta) {
    next.accounts.offset.balance = Math.max(0, Number(next.accounts.offset?.balance || 0) + offsetDelta);
    if (confirmed) next.accounts.offset.confirmedBalance = Math.max(0, Number(next.accounts.offset?.confirmedBalance || 0) + offsetDelta);
  }
  if (externalDelta) {
    next.accounts.externalBalance = Math.max(0, Number(next.accounts.externalBalance || 0) + externalDelta);
  }
  next.loan.totalBalance = next.loan.mode === "single"
    ? Number(next.loan.single?.balance || 0)
    : Number(next.loan.fixed?.balance || 0) + Number(next.loan.variable?.balance || 0);
  return next;
}

export function deleteLoanActivityEvent(state, eventId, today = "2026-04-29") {
  const next = structuredClone(state);
  const activity = normalizeLoanActivity(next.loan?.activity || [], today);
  const event = activity.find((item) => item.id === eventId);
  if (!event) return next;

  if (event.type === "extra_repayment" && event.impact) {
    applyBalanceDeltaForActivity(next, event, 1);
    next.loan.balanceStatus = event.confirmed ? "confirmed" : "estimated";
    if (event.confirmed) {
      next.loan.lastConfirmedDate = today;
      next.loan.nextReconciliationDate = getNextBalanceCheckDate(today, next.loan.reconciliationFrequency || DEFAULT_RECONCILIATION_FREQUENCY);
    }
  }

  next.loan.activity = activity.filter((item) => item.id !== eventId);
  return next;
}

export function updateLoanActivityEvent(state, eventId, patch = {}, today = "2026-04-29") {
  const next = structuredClone(state);
  const activity = normalizeLoanActivity(next.loan?.activity || [], today);
  const event = activity.find((item) => item.id === eventId);
  if (!event) return next;

  let updated = {
    ...event,
    date: patch.date || event.date,
    title: patch.title || event.title,
    detail: patch.detail ?? event.detail,
  };

  if (event.type === "extra_repayment" && event.impact && patch.amount !== undefined && patch.amount !== "") {
    const oldAmount = Number(event.amount || 0);
    const newAmount = Math.max(0, Number(patch.amount || 0));
    const ratio = oldAmount > 0 ? newAmount / oldAmount : 1;
    applyBalanceDeltaForActivity(next, event, 1);
    const nextImpact = {
      ...event.impact,
      requestedAmount: Number(event.impact.requestedAmount || oldAmount) * ratio,
      actualReduction: Number(event.impact.actualReduction || oldAmount) * ratio,
      fixedReduction: Number(event.impact.fixedReduction || 0) * ratio,
      variableReduction: Number(event.impact.variableReduction || 0) * ratio,
      singleReduction: Number(event.impact.singleReduction || 0) * ratio,
      offsetReduction: Number(event.impact.offsetReduction || 0) * ratio,
      externalReduction: Number(event.impact.externalReduction || 0) * ratio,
    };
    updated = { ...updated, amount: newAmount, impact: nextImpact };
    applyBalanceDeltaForActivity(next, updated, -1);
    next.loan.balanceStatus = event.confirmed ? "confirmed" : "estimated";
    if (event.confirmed) next.loan.lastConfirmedDate = today;
  } else if (patch.amount !== undefined && patch.amount !== "") {
    updated.amount = Math.max(0, Number(patch.amount || 0));
  }

  next.loan.activity = normalizeLoanActivity(activity.map((item) => (item.id === eventId ? updated : item)), today);
  return next;
}

export function normalizeLoanForBalances(state, today = "2026-04-29") {
  const next = structuredClone(state);
  const loan = next.loan || {};
  const fixedBalance = Number(loan.fixed?.balance || 0);
  const variableBalance = Number(loan.variable?.balance || 0);
  const singleBalance = Number(loan.single?.balance ?? loan.totalBalance ?? 0);

  next.loan = {
    mode: loan.mode || "split",
    totalBalance: loan.mode === "single" ? singleBalance : fixedBalance + variableBalance,
    fixed: normaliseFixedConfig({
      balance: fixedBalance,
      confirmedBalance: Number(loan.fixed?.confirmedBalance ?? fixedBalance),
      rate: Number(loan.fixed?.rate || 0),
      repaymentAmount: Number(loan.fixed?.repaymentAmount || 0),
      fixedStartDate: loan.fixed?.fixedStartDate || loan.fixedStartDate,
      fixedEndDate: loan.fixed?.fixedEndDate || loan.fixedEndDate,
      fixedTermYears: loan.fixed?.fixedTermYears || loan.fixedTermYears,
      status: loan.fixed?.status,
      rolledDate: loan.fixed?.rolledDate,
    }, today),
    variable: {
      balance: variableBalance,
      confirmedBalance: Number(loan.variable?.confirmedBalance ?? variableBalance),
      rate: Number(loan.variable?.rate || 0),
      repaymentAmount: Number(loan.variable?.repaymentAmount || 0),
    },
    single: {
      balance: singleBalance,
      confirmedBalance: Number(loan.single?.confirmedBalance ?? singleBalance),
      rate: Number(loan.single?.rate || 0),
    },
    repayment: Number(loan.repayment || getMortgageRepaymentAmount(loan) || 0),
    repaymentFrequency: loan.repaymentFrequency || DEFAULT_REPAYMENT_FREQUENCY,
    nextPaymentDate: loan.nextPaymentDate || today,
    balanceStatus: loan.balanceStatus || "confirmed",
    lastConfirmedDate: loan.lastConfirmedDate || today,
    lastEstimatedDate: loan.lastEstimatedDate || "",
    reconciliationFrequency: loan.reconciliationFrequency || DEFAULT_RECONCILIATION_FREQUENCY,
    nextReconciliationDate: loan.nextReconciliationDate || getNextBalanceCheckDate(today, loan.reconciliationFrequency),
    fixedRollover: {
      enabled: loan.fixedRollover?.enabled !== false,
      rolloverDate: loan.fixedRollover?.rolloverDate || loan.fixed?.fixedEndDate || loan.fixedEndDate || "",
      rolloverBehaviour: loan.fixedRollover?.rolloverBehaviour || "merge_into_variable",
      reviewed: Boolean(loan.fixedRollover?.reviewed),
    },
    topUps: normalizeLoanTopUps(loan.topUps || loan.plannedTopUps || [], today),
    activity: normalizeLoanActivity(loan.activity || [], today),
    lastRolloverDate: loan.lastRolloverDate || "",
    lastRolloverMessage: loan.lastRolloverMessage || "",
    lastEstimate: loan.lastEstimate || null,
  };

  next.accounts = next.accounts || {};
  next.accounts.offset = {
    balance: Number(next.accounts.offset?.balance || 0),
    confirmedBalance: Number(next.accounts.offset?.confirmedBalance ?? next.accounts.offset?.balance ?? 0),
    swanFloor: Number(next.accounts.offset?.swanFloor || 0),
    lastConfirmedDate: next.accounts.offset?.lastConfirmedDate || next.loan.lastConfirmedDate,
    balanceStatus: next.accounts.offset?.balanceStatus || next.loan.balanceStatus || "confirmed",
  };

  return next;
}
