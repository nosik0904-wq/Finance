import { getBillAmountRemaining } from "./financeCalculations.js";
import { resolvePaymentPlan } from "./paymentEngine.js";

function isMortgageBill(bill) {
  return /mortgage/i.test(`${bill.name || ""} ${bill.category || ""}`);
}

export function evaluateBillPayment(bill, household, balances) {
  if (bill.accountRule === "offset contribution") {
    return {
      billId: bill.id,
      account: "offset",
      canPay: true,
      covered: bill.amount,
      shortfall: 0,
      message: "Offset contribution increases the offset balance.",
      isContribution: true,
    };
  }

  const amountRemaining = getBillAmountRemaining(bill);
  const directAccount =
    bill.accountRule === "external" || bill.accountRule === "offset" ? bill.accountRule : null;

  if (directAccount) {
    const canPay = Number(balances[directAccount] || 0) >= amountRemaining;
    return {
      billId: bill.id,
      account: directAccount,
      canPay,
      covered: canPay ? amountRemaining : Number(balances[directAccount] || 0),
      shortfall: canPay ? 0 : amountRemaining - Number(balances[directAccount] || 0),
      message: canPay ? `Ready from ${directAccount}.` : `Shortfall in ${directAccount}.`,
      isContribution: false,
    };
  }

  const plan = resolvePaymentPlan(bill, household, balances);
  const totalAvailable = plan.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return {
    billId: bill.id,
    account: plan.payments[0]?.account || "auto",
    overflowAccount: plan.payments[1]?.account,
    canPay: plan.canPay,
    covered: Math.min(totalAvailable, amountRemaining),
    shortfall: Math.max(0, amountRemaining - totalAvailable),
    message: plan.message || (plan.canPay ? "Covered by bill flow." : "Not enough in bill flow."),
    isContribution: false,
  };
}

export function evaluateWaterfall(bills, household) {
  const balances = {
    external: Number(household.externalBalance || 0),
    offset: Number(household.offsetBalance || 0),
  };

  return [...bills].sort((a, b) => {
    const dateSort = (a.nextDueDate || "9999-12-31").localeCompare(b.nextDueDate || "9999-12-31");
    if (dateSort !== 0) return dateSort;
    return Number(isMortgageBill(b)) - Number(isMortgageBill(a));
  }).reduce((map, bill) => {
    map[bill.id] = evaluateBillPayment(bill, household, balances);
    if (map[bill.id].isContribution) {
      balances.offset += Number(bill.amount || 0);
    } else if (map[bill.id].canPay && bill.status === "active") {
      const covered = getBillAmountRemaining(bill);
      const mainPayment = Math.min(Number(balances[map[bill.id].account] || 0), covered);
      balances[map[bill.id].account] = Math.max(0, Number(balances[map[bill.id].account] || 0) - mainPayment);
      const overflowPayment = covered - mainPayment;
      if (overflowPayment > 0 && map[bill.id].overflowAccount) {
        balances[map[bill.id].overflowAccount] = Math.max(
          0,
          Number(balances[map[bill.id].overflowAccount] || 0) - overflowPayment,
        );
      }
    }
    return map;
  }, {});
}
