import {
  addDays,
  calculateFortnightSurplus,
  calculateLoanMetrics,
  dueInWindow,
  getBillAmountRemaining,
  getBillOccurrences,
  getPartnerFlow,
} from "./financeCalculations.js";
import {
  getConfirmedLoanTotal,
  getFixedRolloverInfo,
  getLoanStatusLabel,
  getLoanTopUpAlerts,
  getLoanTopUpsDueInWindow,
  getMortgageRepaymentAmount,
  getWorkingLoanTotal,
  isBalanceCheckDue,
} from "./loanLogic.js";

export function getBillsByCategory(bills, today, days = 90) {
  const totals = bills
    .flatMap((bill) => getBillOccurrences(bill, today, days))
    .filter((bill) => bill.accountRule !== "offset contribution")
    .reduce((map, bill) => {
      const category = bill.category || "Other";
      map[category] = (map[category] || 0) + getBillAmountRemaining(bill);
      return map;
    }, {});

  return Object.entries(totals)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export function getBillsByWeek(bills, today, weeks = 13) {
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(today, index * 7);
    const end = addDays(start, 6);
    const total = dueInWindow(bills, start, 6)
      .filter((bill) => bill.accountRule !== "offset contribution")
      .reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);
    return { label: `W${index + 1}`, start, end, value: total };
  });
}

export function getProjectedOffset(household, bills, today, days = 90) {
  if (household?.accounts) {
    let offset = Number(household.accounts.offset.balance || 0);
    const partnerAIncome = household.income?.find((income) => income.partner === "A");
    const partnerBIncome = household.income?.find((income) => income.partner === "B");
    return Array.from({ length: Math.ceil(days / 7) + 1 }, (_, index) => {
      const date = addDays(today, index * 7);
      dueInWindow(bills, date, 6).forEach((bill) => {
        const amount = getBillAmountRemaining(bill);
        if (bill.accountRule === "offsetContribution") offset += amount;
        if (bill.accountRule === "offset") offset -= amount;
      });
      if (date <= partnerAIncome?.nextPaydate && partnerAIncome?.route === "offset") offset += Number(partnerAIncome.amount || 0);
      if (date <= partnerBIncome?.nextPaydate && partnerBIncome?.route === "offset") offset += Number(partnerBIncome.amount || 0);
      return { label: `W${index + 1}`, value: Math.max(0, offset) };
    });
  }
  let offset = Number(household.offsetBalance || 0);
  const points = [];

  for (let index = 0; index <= days; index += 7) {
    const date = addDays(today, index);
    const weekBills = dueInWindow(bills, date, 6);
    weekBills.forEach((bill) => {
      const amount = getBillAmountRemaining(bill);
      if (bill.accountRule === "offset contribution") offset += amount;
      if (bill.accountRule === "offset") offset -= amount;
      if (bill.accountRule === "auto" && getPartnerFlow("partnerA", household) === "offset_overflow") {
        offset -= Math.max(0, amount - Number(household.externalBalance || 0));
      }
    });

    if (date === household.nextPaydayA && household.partnerAIncomeRoute === "offset") {
      offset += Number(household.partnerAFortnightIncome || 0);
    }
    if (date === household.nextPaydayB && household.partnerBIncomeRoute === "offset") {
      offset += Number(household.partnerBFortnightIncome || 0);
    }
    if (household.partnerALeftoverRule === "transfer_offset" && household.partnerAIncomeRoute !== "offset") {
      offset += Number(household.partnerAFortnightIncome || 0) * 0.1;
    }
    if (household.partnerBLeftoverRule === "transfer_offset" && household.partnerBIncomeRoute !== "offset") {
      offset += Number(household.partnerBFortnightIncome || 0) * 0.1;
    }

    points.push({ label: `W${Math.floor(index / 7) + 1}`, value: Math.max(0, offset) });
  }

  return points;
}

export function getInterestTrend(household, days = 90) {
  return Array.from({ length: 13 }, (_, index) => {
    const simulated = {
      ...household,
      offsetBalance: Number(household.offsetBalance || 0) + index * 900,
    };
    return {
      label: `W${index + 1}`,
      value: calculateLoanMetrics(simulated).dailyNetInterest * 7,
    };
  });
}

export function getNextMajorBill(bills, today) {
  return dueInWindow(bills, today, 90)
    .filter((bill) => bill.accountRule !== "offset contribution")
    .sort((a, b) => getBillAmountRemaining(b) - getBillAmountRemaining(a))[0];
}

export function getSwanStatus(household) {
  const offset = Number(household.accounts?.offset?.balance ?? household.offsetBalance ?? 0);
  const floor = Number(household.accounts?.offset?.swanFloor ?? household.swanFloor ?? 0);
  const progress = floor <= 0 ? 100 : Math.min(100, (offset / floor) * 100);
  return {
    gap: offset - floor,
    progress,
    label: offset >= floor ? "Safe" : offset >= floor * 0.75 ? "Tight" : "Action needed",
    tone: offset >= floor ? "safe" : offset >= floor * 0.75 ? "warning" : "issue",
  };
}

export function getCashflowHealth(household, bills, today) {
  const breathingRoom = calculateFortnightSurplus(household, bills, today);
  const swan = getSwanStatus(household);
  const alerts = bills.filter((bill) => bill.status === "partial" || bill.status === "unable to pay").length;
  let score = 78;

  score += Math.min(12, Math.max(-28, breathingRoom / 150));
  score += swan.gap >= 0 ? 10 : Math.max(-25, swan.gap / 1000);
  score -= alerts * 12;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const label = score >= 75 && alerts === 0 ? "Safe" : score >= 50 ? "Tight" : "Action needed";
  const tone = label === "Safe" ? "safe" : label === "Tight" ? "warning" : "issue";
  return { score, label, tone, breathingRoom, alerts };
}

export function getIncomeForecast(household, bills, today, partner) {
  const isA = partner === "partnerA";
  const income = Number(isA ? household.partnerAFortnightIncome : household.partnerBFortnightIncome || 0);
  const nextPayday = isA ? household.nextPaydayA : household.nextPaydayB;
  const flow = isA ? household.partnerAFlow : household.partnerBFlow;
  const dueBills = dueInWindow(bills, today, 14).filter((bill) => bill.accountRule !== "offset contribution");
  const flowPays = (value) => value === "bills" || value === "mortgage_bills" || value === "joint_bills";
  const partnerPays = flowPays(flow);
  const otherFlow = isA ? household.partnerBFlow : household.partnerAFlow;
  const otherPays = flowPays(otherFlow);
  const totalBillLoad = dueBills.reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);
  const billLoad = partnerPays ? (otherPays ? totalBillLoad / 2 : totalBillLoad) : 0;
  const surplus = income - billLoad;

  return {
    income,
    nextPayday,
    flow,
    billLoad,
    surplus,
    covered: surplus >= 0,
  };
}

export function getFreedomDate(household, loanMetrics) {
  const repayment = household.loan ? getMortgageRepaymentAmount(household.loan) : Number(household.standardRepayment ?? 0);
  const fortnightInterest = Number(loanMetrics.dailyNetInterest || 0) * 14;
  const principalPerFortnight = Math.max(1, repayment - fortnightInterest);
  const fortnights = Math.ceil(Number(loanMetrics.totalBalance || 0) / principalPerFortnight);
  const years = Math.max(0, fortnights / 26);
  const currentYear = 2026;
  return {
    years,
    label: years > 40 ? "40+ years" : `${years.toFixed(1)} years`,
    year: years > 40 ? "Beyond 2066" : String(Math.round(currentYear + years)),
  };
}

export function generateWeeklyMoneyCheckIn(state, today) {
  const weekBills = dueInWindow(state.bills, today, 7)
    .filter((bill) => bill.accountRule !== "offsetContribution")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const weekIncome = (state.income || [])
    .filter((income) => income.nextPaydate >= today && income.nextPaydate <= addDays(today, 7))
    .sort((a, b) => a.nextPaydate.localeCompare(b.nextPaydate));
  const weekTopUps = getLoanTopUpsDueInWindow(state, today, 7);
  const topUpAlerts = getLoanTopUpAlerts(state, today);
  const borrowedToOffset = weekTopUps
    .filter((topUp) => topUp.destinationAccount === "offset")
    .reduce((sum, topUp) => sum + Number(topUp.amount || 0), 0);
  const borrowedToExternal = weekTopUps
    .filter((topUp) => topUp.destinationAccount === "external")
    .reduce((sum, topUp) => sum + Number(topUp.amount || 0), 0);

  const loanMetrics = calculateLoanMetrics(state);
  const projectedBillTotal = weekBills.reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);
  const projectedIncome = weekIncome.reduce((sum, income) => sum + Number(income.amount || 0), 0);
  const projectedOffset = Number(state.accounts.offset.balance || 0) + borrowedToOffset + weekIncome
    .filter((income) => income.route === "offset")
    .reduce((sum, income) => sum + Number(income.amount || 0), 0) - weekBills
    .filter((bill) => bill.accountRule === "offset" || bill.locked)
    .reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);
  const projectedExternal = Number(state.accounts.externalBalance || 0) + borrowedToExternal + weekIncome
    .filter((income) => income.route === "external")
    .reduce((sum, income) => sum + Number(income.amount || 0), 0) - weekBills
    .filter((bill) => bill.accountRule === "external" || bill.accountRule === "auto")
    .reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);

  const swanGap = projectedOffset - Number(state.accounts.offset.swanFloor || 0);
  const balanceCheckDue = isBalanceCheckDue(state, today);
  const fixedRollover = getFixedRolloverInfo(state.loan, today);
  const staleLabel = state.loan.lastConfirmedDate ? `Last checked ${state.loan.lastConfirmedDate}` : "Not checked yet";

  const alerts = [];
  if (swanGap < 0) alerts.push(`Offset may fall below SWAN floor by $${Math.abs(swanGap).toFixed(0)} this week.`);
  const shortBills = weekBills.filter((bill) => {
    const amount = getBillAmountRemaining(bill);
    if (bill.accountRule === "offset" || bill.locked) return Number(state.accounts.offset.balance || 0) < amount;
    if (bill.accountRule === "external" || bill.accountRule === "auto") return Number(state.accounts.externalBalance || 0) < amount;
    return false;
  });
  if (shortBills.length) alerts.push(`${shortBills[0].name} may need attention before it is due.`);
  if (balanceCheckDue) alerts.push("Mortgage balance check is due.");
  if (fixedRollover.status === "ending_soon") alerts.push(`Fixed split ends in ${fixedRollover.daysRemaining} days.`);
  if (fixedRollover.status === "expired") alerts.push("Fixed split has reached its end date. Confirm the new variable rate and repayment.");
  if (fixedRollover.status === "rolled_to_variable" && !state.loan.fixedRollover?.reviewed) alerts.push("Fixed split has rolled into variable. Confirm the bank's new rate when it appears.");
  topUpAlerts.slice(0, 1).forEach((alert) => alerts.push(alert.message));
  state.bills.filter((bill) => bill.status === "flagged").slice(0, 1).forEach((bill) => alerts.push(`${bill.name} is flagged for review.`));

  const actions = [];
  if (swanGap < 0) actions.push(`Move $${Math.abs(swanGap).toFixed(0)} to offset to protect the SWAN floor.`);
  if (balanceCheckDue) actions.push("Confirm fixed, variable and offset balances from the bank app.");
  if (fixedRollover.status === "ending_soon") actions.push("Check your fixed loan end date and upcoming variable rate.");
  if (fixedRollover.status === "expired" || (fixedRollover.status === "rolled_to_variable" && !state.loan.fixedRollover?.reviewed)) actions.push("Confirm the new variable rate and repayment after fixed rollover.");
  if (topUpAlerts.some((alert) => alert.type === "overdue_top_up")) actions.push("Confirm or cancel the planned variable loan top-up.");
  else if (topUpAlerts.length) actions.push("Review the planned variable top-up details before the bank confirms it.");
  if (shortBills.length) actions.push(`Check ${shortBills[0].name} before ${shortBills[0].dueDate}.`);
  if (actions.length === 0) actions.push("No action needed this week.");

  return {
    title: "Weekly Money Check-in",
    intro: "Here’s your money snapshot for the week.",
    accountSummary: {
      externalBalance: Number(state.accounts.externalBalance || 0),
      offsetBalance: Number(state.accounts.offset.balance || 0),
      offsetStatus: getLoanStatusLabel(state.accounts.offset.balanceStatus),
      swanFloor: Number(state.accounts.offset.swanFloor || 0),
      fixedBalance: Number(state.loan.fixed?.balance || 0),
      fixedRate: Number(state.loan.fixed?.rate || 0),
      fixedEndDate: state.loan.fixed?.fixedEndDate || "",
      fixedStatus: fixedRollover.status,
      fixedDaysRemaining: fixedRollover.daysRemaining,
      variableBalance: Number(state.loan.variable?.balance || 0),
      variableRate: Number(state.loan.variable?.rate || 0),
      totalMortgageBalance: getWorkingLoanTotal(state.loan),
      confirmedMortgageBalance: getConfirmedLoanTotal(state.loan),
      loanStatus: getLoanStatusLabel(state.loan.balanceStatus),
      staleLabel,
      plannedTopUpsTotal: (state.loan.topUps || []).filter((topUp) => topUp.status === "planned").reduce((sum, topUp) => sum + Number(topUp.amount || 0), 0),
      nextTopUpDate: (state.loan.topUps || []).filter((topUp) => topUp.status === "planned").sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0]?.expectedDate || "",
    },
    alerts: alerts.length ? alerts.slice(0, 4) : ["No major alerts this week."],
    billsDue: weekBills,
    incomeDue: weekIncome,
    mortgageCheck: {
      due: balanceCheckDue,
      nextCheckDate: state.loan.nextReconciliationDate,
      lastConfirmedDate: state.loan.lastConfirmedDate,
      estimatedBalance: getWorkingLoanTotal(state.loan),
      confirmedBalance: getConfirmedLoanTotal(state.loan),
      status: getLoanStatusLabel(state.loan.balanceStatus),
      fixedRollover,
      topUps: topUpAlerts,
    },
    outlook: {
      projectedIncome,
      projectedBillTotal,
      projectedOffset,
      projectedExternal,
      swanGap,
      weeklyNet: projectedIncome - projectedBillTotal,
      dailyNetInterest: loanMetrics.dailyNetInterest,
      borrowedFunds: borrowedToOffset + borrowedToExternal,
    },
    actions: actions.slice(0, 3),
  };
}

export function validateLoan(household) {
  const warnings = [];
  if (household?.loan) {
    const rates = [household.loan.fixed.rate, household.loan.variable.rate, household.loan.single.rate].map(Number);
    const balances = [household.loan.totalBalance, household.loan.fixed.balance, household.loan.variable.balance, household.loan.single.balance].map(Number);
    if (rates.some((rate) => rate <= 0)) warnings.push("Rates must be positive.");
    if (rates.some((rate) => rate > 15)) warnings.push("Interest rate looks unusually high. Check the decimal/percentage entered.");
    if (balances.some((balance) => balance < 0)) warnings.push("Loan balances must not be negative.");
    if (Number(getMortgageRepaymentAmount(household.loan) || 0) <= 0) warnings.push("Mortgage repayment must be above $0 unless this loan is intentionally paused.");
    if (!household.loan.nextPaymentDate) warnings.push("Next mortgage payment date is required.");
    if (household.loan.mode === "split" && household.loan.fixed?.fixedEndDate && household.loan.fixed?.fixedStartDate && household.loan.fixed.fixedEndDate < household.loan.fixed.fixedStartDate) warnings.push("Fixed end date cannot be before the fixed start date.");
    if (household.loan.mode === "split") {
      const splitTotal = Number(household.loan.fixed.balance || 0) + Number(household.loan.variable.balance || 0);
      if (Number(household.loan.totalBalance || 0) > 0 && Math.abs(splitTotal - Number(household.loan.totalBalance || 0)) > 1) {
        warnings.push("Split balances do not equal the total loan balance.");
      }
    }
    return warnings;
  }
  const rates = [household.fixedRate, household.variableRate, household.singleLoanRate].map(Number);
  const balances = [household.totalLoanBalance, household.fixedBalance, household.variableBalance].map(Number);

  if (rates.some((rate) => rate < 0)) warnings.push("Rates must be positive.");
  if (rates.some((rate) => rate > 15)) warnings.push("Interest rate looks unusually high. Check the decimal/percentage entered.");
  if (balances.some((balance) => balance < 0)) warnings.push("Loan balances must not be negative.");
  if (household.loanMode === "split") {
    const splitTotal = Number(household.fixedBalance || 0) + Number(household.variableBalance || 0);
    if (Number(household.totalLoanBalance || 0) > 0 && Math.abs(splitTotal - Number(household.totalLoanBalance || 0)) > 1) {
      warnings.push("Split balances do not equal the total loan balance.");
    }
  }

  return warnings;
}
