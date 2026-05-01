const MS_PER_DAY = 1000 * 60 * 60 * 24;

function parseLocalDate(value) {
  return new Date(`${value}T00:00:00`);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function shortDate(value) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(parseLocalDate(value));
}

export function daysBetween(start, end) {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  return Math.ceil((endDate - startDate) / MS_PER_DAY);
}

export function addDays(date, days) {
  const next = parseLocalDate(date);
  next.setDate(next.getDate() + days);
  return toDateKey(next);
}

export function addMonthsClamped(date, months, preferredDay) {
  const source = parseLocalDate(date);
  const day = preferredDay || source.getDate();
  const target = new Date(source);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return toDateKey(target);
}

export function getPartnerLabel(value, household) {
  if (value === "A") return household.partnerAName || "Carl";
  if (value === "B") return household.partnerBName || "Kim";
  if (value === "partnerA") return household.partnerAName || "Partner A";
  if (value === "partnerB") return household.partnerBName || "Partner B";
  return "Joint";
}

export function getAccountForHandler(handler, household) {
  if (handler === "partnerA") return household.partnerAIncomeRoute;
  if (handler === "partnerB") return household.partnerBIncomeRoute;
  return "external";
}

export function getPartnerFlow(partner, household) {
  if (partner === "partnerA") return household.partnerAFlow || "offset_overflow";
  if (partner === "partnerB") return household.partnerBFlow || "bills";
  return "joint_bills";
}

export function flowPaysBills(flow) {
  return flow === "bills" || flow === "mortgage_bills" || flow === "joint_bills";
}

export function flowPaysMortgage(flow) {
  return flow === "mortgage" || flow === "mortgage_bills";
}

export function getBillPayingPartners(household) {
  const partners = ["partnerA", "partnerB"].filter((partner) => flowPaysBills(getPartnerFlow(partner, household)));
  if (partners.length > 0) return partners;
  return [household.mainBillHandler || "partnerB", household.overflowHandler || "partnerA"].filter((value, index, arr) => value !== "joint" && arr.indexOf(value) === index);
}

export function getMortgagePayingPartners(household) {
  const partners = ["partnerA", "partnerB"].filter((partner) => flowPaysMortgage(getPartnerFlow(partner, household)));
  if (partners.length > 0) return partners;
  if (household.mortgagePayer === "joint") return ["partnerA", "partnerB"];
  return [household.mortgagePayer || "partnerB"];
}

export function getLoanParts(household) {
  if (household?.loan) return getLoanParts(household.loan);
  if (household.mode === "single") {
    return [{ balance: household.single?.balance ?? household.totalBalance, rate: household.single?.rate, offsetEligible: true }];
  }
  if (household.fixed && household.variable) {
    return [
      { balance: household.fixed.balance, rate: household.fixed.rate, offsetEligible: false },
      { balance: household.variable.balance, rate: household.variable.rate, offsetEligible: true },
    ];
  }
  if (household.loanMode === "single") {
    return [{ balance: household.totalLoanBalance, rate: household.singleLoanRate, offsetEligible: true }];
  }

  return [
    { balance: household.fixedBalance, rate: household.fixedRate, offsetEligible: false },
    { balance: household.variableBalance, rate: household.variableRate, offsetEligible: true },
  ];
}

export function calculateLoanMetrics(household) {
  if (household?.loan) {
    const metrics = calculateLoanMetrics(household.loan);
    const offsetRate = household.loan.mode === "split" ? household.loan.variable.rate : household.loan.single.rate;
    const offsetEligibleBalance =
      household.loan.mode === "split" ? Number(household.loan.variable.balance || 0) : Number(household.loan.single.balance || household.loan.totalBalance || 0);
    const offsetApplied = Math.min(Number(household.accounts?.offset?.balance || 0), offsetEligibleBalance);
    const offsetCredit = (offsetApplied * Number(offsetRate || 0)) / 100 / 365;
    return {
      ...metrics,
      offsetCredit,
      dailyNetInterest: Math.max(0, metrics.dailyGrossInterest - offsetCredit),
      monthlyInterest: Math.max(0, metrics.dailyGrossInterest - offsetCredit) * 30.4375,
      yearlyInterest: Math.max(0, metrics.dailyGrossInterest - offsetCredit) * 365,
    };
  }
  const parts = getLoanParts(household);
  const totalBalance = parts.reduce((sum, part) => sum + Number(part.balance || 0), 0);
  const weightedRate =
    totalBalance === 0
      ? 0
      : parts.reduce((sum, part) => sum + Number(part.balance || 0) * Number(part.rate || 0), 0) / totalBalance;
  const dailyGrossInterest = parts.reduce(
    (sum, part) => sum + (Number(part.balance || 0) * Number(part.rate || 0)) / 100 / 365,
    0,
  );
  const offsetRate = household.loanMode === "split" ? household.variableRate : household.singleLoanRate;
  const offsetEligibleBalance =
    household.loanMode === "split" ? Number(household.variableBalance || 0) : Number(household.totalLoanBalance || 0);
  const offsetApplied = Math.min(Number(household.offsetBalance || 0), offsetEligibleBalance);
  const offsetCredit = (offsetApplied * Number(offsetRate || 0)) / 100 / 365;
  const dailyNetInterest = Math.max(0, dailyGrossInterest - offsetCredit);

  return {
    totalBalance,
    weightedRate,
    dailyGrossInterest,
    offsetCredit,
    dailyNetInterest,
    monthlyInterest: dailyNetInterest * 30.4375,
    yearlyInterest: dailyNetInterest * 365,
  };
}

export function dueInWindow(bills, startDate, days) {
  return bills
    .flatMap((bill) => getBillOccurrences(bill, startDate, days))
    .sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}

export function getBillOccurrences(bill, startDate, days) {
  if (bill.status === "cancelled" || bill.status === "retired") return [];
  const firstDueDate = bill.dueDate || bill.nextDueDate;
  if (!firstDueDate) return [];
  const end = addDays(startDate, days);
  const occurrences = [];
  let dueDate = firstDueDate;

  while (dueDate <= end) {
    const finish = bill.endDate || bill.finishDate;
    if (dueDate >= startDate && (!finish || dueDate <= finish)) {
      occurrences.push({ ...bill, dueDate, nextDueDate: dueDate, occurrenceDate: dueDate });
    }

    const next = getNextDueDate({ ...bill, dueDate, nextDueDate: dueDate });
    if (!next || next === dueDate || bill.frequency === "once" || bill.recurrence === "none") break;
    dueDate = next;
  }

  return occurrences;
}

export function getBillAmountRemaining(bill) {
  return Math.max(0, Number(bill.amount || 0) - Number(bill.amountCovered || 0));
}

export function getOpenAlerts(bills) {
  return bills.filter((bill) => bill.status === "partial" || bill.status === "unable to pay");
}

export function isRetirableAfterPayment(bill) {
  if (bill.frequency === "once" || bill.recurrence === "none") return true;
  const finish = bill.endDate || bill.finishDate;
  if (!finish) return false;
  return (bill.dueDate || bill.nextDueDate) >= finish;
}

export function getNextDueDate(bill) {
  const frequency = bill.recurrence || bill.frequency;
  const current = bill.dueDate || bill.nextDueDate;
  if (frequency === "weekly") return addDays(current, 7);
  if (frequency === "fortnightly") return addDays(current, 14);
  const preferredDay = bill.startDate ? parseLocalDate(bill.startDate).getDate() : undefined;
  if (frequency === "monthly") return addMonthsClamped(current, 1, preferredDay);
  if (frequency === "quarterly") return addMonthsClamped(current, 3, preferredDay);
  if (frequency === "annually") return addMonthsClamped(current, 12, preferredDay);
  return current;
}

export function calculateFortnightSurplus(household, bills, startDate = "2026-04-27") {
  const income = Number(household.partnerAFortnightIncome || 0) + Number(household.partnerBFortnightIncome || 0);
  const expenses = dueInWindow(bills, startDate, 14)
    .filter((bill) => bill.accountRule !== "offset contribution")
    .reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);
  return income - expenses;
}
