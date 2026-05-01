import { calculateLoanMetrics } from "./financeCalculations.js";
import { deepClone, simulateFortnight } from "./engine.js";

export function runScenario(state, scenario, today) {
  const projected = deepClone(state);
  const incomeA = projected.income.find((income) => income.partner === "A");
  const incomeB = projected.income.find((income) => income.partner === "B");

  incomeA.amount += Number(scenario.payRise || 0);
  incomeB.amount = Math.max(0, incomeB.amount - Number(scenario.incomeDrop || 0));
  projected.accounts.offset.balance = Math.max(
    0,
    Number(projected.accounts.offset.balance || 0) - Number(scenario.offsetWithdrawal || 0) - Number(scenario.emergencyCost || 0),
  );

  if (Number(scenario.rateRise || 0)) {
    projected.loan.fixed.rate += Number(scenario.rateRise || 0);
    projected.loan.variable.rate += Number(scenario.rateRise || 0);
    projected.loan.single.rate += Number(scenario.rateRise || 0);
  }

  const addedBillAmount = Number(scenario.newRecurringBill || 0) + Number(scenario.schoolFees || 0) + Number(scenario.carLoan || 0);
  if (addedBillAmount > 0) {
    projected.bills.push({
      id: "scenario-bill",
      name: "Scenario commitments",
      amount: addedBillAmount,
      lastAmount: addedBillAmount,
      category: "Scenario",
      dueDate: today,
      startDate: today,
      endDate: "",
      recurrence: "fortnightly",
      accountRule: "auto",
      status: "confirmed",
      paidBy: "",
      amountCovered: 0,
      deferredTo: "",
      auditLog: [],
    });
  }

  const baseSim = simulateFortnight(state, today);
  const scenarioSim = simulateFortnight(projected, today);
  const baseLoan = calculateLoanMetrics(state);
  const projectedLoan = calculateLoanMetrics(projected);
  const swanGap = scenarioSim.offsetAfter - Number(projected.accounts.offset.swanFloor || 0);
  const extraInterest = Math.max(0, (projectedLoan.dailyNetInterest - baseLoan.dailyNetInterest) * 14);
  const riskLevel = swanGap < 0 || scenarioSim.breathingRoom < 0 ? "High" : scenarioSim.breathingRoom < 1000 || scenarioSim.flagged.length ? "Medium" : "Low";

  return {
    liveBreathingRoom: baseSim.breathingRoom,
    newFortnightSurplus: scenarioSim.breathingRoom,
    swanGap,
    extraInterest,
    riskLevel,
    verdict:
      riskLevel === "High"
        ? "Action needed. This pushes the household past a guardrail."
        : riskLevel === "Medium"
          ? "Watch closely. It can work, but the margin is thin."
          : "Looks resilient. The household keeps healthy breathing room.",
  };
}
