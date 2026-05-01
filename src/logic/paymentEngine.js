import {
  getBillAmountRemaining,
  getBillPayingPartners,
  getMortgagePayingPartners,
  getPartnerLabel,
  getNextDueDate,
  isRetirableAfterPayment,
} from "./financeCalculations.js";

function getPartnerAccount(partner, household) {
  return partner === "partnerA" ? household.partnerAIncomeRoute : household.partnerBIncomeRoute;
}

function isMortgageBill(bill) {
  return /mortgage/i.test(`${bill.name || ""} ${bill.category || ""}`);
}

function resolveAutoPlan(bill, amount, household, balances) {
  const partners = isMortgageBill(bill) ? getMortgagePayingPartners(household) : getBillPayingPartners(household);
  const candidates = partners
    .map((partner) => ({
      partner,
      account: getPartnerAccount(partner, household),
      balance: Number(balances[getPartnerAccount(partner, household)] || 0),
    }))
    .sort((a, b) => {
      if (a.account !== b.account) return a.account === "external" ? -1 : 1;
      return b.balance - a.balance;
    });

  const payments = [];
  let remaining = amount;
  const workingBalances = { ...balances };

  candidates.forEach((candidate) => {
    if (remaining <= 0) return;
    const available = Number(workingBalances[candidate.account] || 0);
    const payment = Math.min(available, remaining);
    if (payment > 0) {
      payments.push({ account: candidate.account, amount: payment, partner: candidate.partner });
      workingBalances[candidate.account] = available - payment;
      remaining -= payment;
    }
  });

  return {
    canPay: remaining <= 0,
    payments,
    contribution: 0,
    archiveAccount: payments.map((payment) => payment.account).filter((value, index, arr) => arr.indexOf(value) === index).join(" + "),
    message:
      partners.length > 1
        ? `${isMortgageBill(bill) ? "Mortgage" : "Joint bill"} flow uses ${payments.map((payment) => getPartnerLabel(payment.partner, household)).join(" + ") || "available cash"}.`
        : `${isMortgageBill(bill) ? "Mortgage" : "Auto bill"} flow uses ${getPartnerLabel(partners[0], household)}.`,
  };
}

export function resolvePaymentPlan(bill, household, balances) {
  const amount = getBillAmountRemaining(bill);

  if (bill.accountRule === "offset contribution") {
    return {
      canPay: true,
      payments: [],
      contribution: amount,
      archiveAccount: "offset contribution",
    };
  }

  if (bill.accountRule === "external" || bill.accountRule === "offset") {
    return {
      canPay: Number(balances[bill.accountRule] || 0) >= amount,
      payments: [{ account: bill.accountRule, amount }],
      contribution: 0,
      archiveAccount: bill.accountRule,
    };
  }

  return resolveAutoPlan(bill, amount, household, balances);
}

export function applyPaidBillLifecycle(bills, paidBill) {
  return isRetirableAfterPayment(paidBill)
    ? bills.filter((bill) => bill.id !== paidBill.id)
    : bills.map((bill) =>
        bill.id === paidBill.id
          ? { ...bill, status: "active", amountCovered: 0, nextDueDate: getNextDueDate(bill) }
          : bill,
      );
}

export function applyPaymentToBalances(household, plan) {
  const next = { ...household };

  plan.payments.forEach((payment) => {
    if (payment.account === "external") {
      next.externalBalance = Math.max(0, Number(next.externalBalance || 0) - Number(payment.amount || 0));
    }
    if (payment.account === "offset") {
      next.offsetBalance = Math.max(0, Number(next.offsetBalance || 0) - Number(payment.amount || 0));
    }
  });

  if (plan.contribution) {
    next.offsetBalance = Number(next.offsetBalance || 0) + Number(plan.contribution || 0);
  }

  return next;
}

export function buildPaidRecord(bill, plan, paidDate, household) {
  const coveredBy = plan.payments?.length
    ? plan.payments.map((payment) => payment.partner ? getPartnerLabel(payment.partner, household) : payment.account).join(" + ")
    : plan.archiveAccount;

  return {
    id: `paid-${bill.id}-${Date.now()}`,
    name: bill.name,
    amount: getBillAmountRemaining(bill),
    paidDate,
    account: plan.archiveAccount,
    whoPays: bill.whoPays,
    coveredBy,
    payments: plan.payments || [],
    category: bill.category,
  };
}

export function autoAssumePaid(state, today) {
  let household = { ...state.household };
  let bills = [...state.bills];
  const archive = [...state.archive];

  const dueBills = bills
    .filter((bill) => bill.nextDueDate)
    .filter((bill) => bill.nextDueDate <= today)
    .filter((bill) => bill.status === "active")
    .filter((bill) => getBillAmountRemaining(bill) > 0)
    .sort((a, b) => {
      const dateSort = a.nextDueDate.localeCompare(b.nextDueDate);
      if (dateSort !== 0) return dateSort;
      return Number(isMortgageBill(b)) - Number(isMortgageBill(a));
    });

  dueBills.forEach((bill) => {
    const plan = resolvePaymentPlan(bill, household, {
      external: household.externalBalance,
      offset: household.offsetBalance,
    });

    if (!plan.canPay) return;

    household = applyPaymentToBalances(household, plan);
    archive.unshift(buildPaidRecord(bill, plan, today, household));
    bills = applyPaidBillLifecycle(bills, bill);
  });

  return { household, bills, archive };
}
