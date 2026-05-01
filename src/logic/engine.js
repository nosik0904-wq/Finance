import {
  addDays,
  calculateLoanMetrics,
  daysBetween,
  dueInWindow,
  getBillAmountRemaining,
  getNextDueDate,
  shortDate,
} from "./financeCalculations.js";
import {
  applyEstimatedMortgageRepayment,
  applyFixedRateRollover,
  getMortgageRepaymentAmount,
  normalizeLoanForBalances,
} from "./loanLogic.js";
import { appendFullArchiveRecord, normalizeAuditTrail } from "./auditTrail.js";

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeState(raw, fallback) {
  if (!raw) return normalizeAuditTrail(normalizeLoanForBalances(deepClone(fallback)));
  if (raw.income && raw.accounts && raw.loan && raw.rules) return normalizeAuditTrail(normalizeLoanForBalances(raw));

  return normalizeAuditTrail(normalizeLoanForBalances({
    household: {
      householdName: raw.household?.householdName || "Household",
      partnerAName: raw.household?.partnerAName || "Carl",
      partnerBName: raw.household?.partnerBName || "Kim",
      fortnightAnchorDate: raw.household?.fortnightAnchorDate || "2026-04-24",
      varianceTolerancePercent: raw.household?.varianceTolerancePercent || 20,
    },
    income: [
      {
        partner: "A",
        amount: Number(raw.household?.partnerAFortnightIncome || 0),
        route: raw.household?.partnerAIncomeRoute || "offset",
        nextPaydate: raw.household?.nextPaydayA || "2026-05-08",
        typicalSurplus: 0,
      },
      {
        partner: "B",
        amount: Number(raw.household?.partnerBFortnightIncome || 0),
        route: raw.household?.partnerBIncomeRoute || "external",
        nextPaydate: raw.household?.nextPaydayB || "2026-05-01",
        typicalSurplus: 0,
      },
    ],
    accounts: {
      externalBalance: Number(raw.household?.externalBalance || 0),
      offset: {
        balance: Number(raw.household?.offsetBalance || 0),
        swanFloor: Number(raw.household?.swanFloor || 0),
      },
    },
    loan: {
      mode: raw.household?.loanMode || "split",
      totalBalance: Number(raw.household?.totalLoanBalance || 0),
      fixed: {
        balance: Number(raw.household?.fixedBalance || 0),
        rate: Number(raw.household?.fixedRate || 0),
        fixedStartDate: raw.household?.fixedStartDate,
        fixedEndDate: raw.household?.fixedEndDate,
        fixedTermYears: raw.household?.fixedTermYears,
      },
      variable: { balance: Number(raw.household?.variableBalance || 0), rate: Number(raw.household?.variableRate || 0) },
      single: { balance: Number(raw.household?.totalLoanBalance || 0), rate: Number(raw.household?.singleLoanRate || 0) },
      repayment: Number(raw.household?.standardRepayment || 0),
      nextPaymentDate: raw.household?.mortgageDueDate || "2026-05-08",
    },
    rules: {
      mainBillHandler: raw.household?.mainBillHandler === "partnerA" ? "A" : "B",
      overflowHandler: raw.household?.overflowHandler === "partnerB" ? "B" : "A",
      mortgagePayer: raw.household?.mortgagePayer === "partnerB" ? "B" : "A",
      partnerAFlow: "offset_mortgage_overflow",
      partnerBFlow: "external_bills",
      partnerBLeftover: "forgotten",
    },
    bills: (raw.bills || []).map(normalizeBill),
    archive: raw.archive || [],
    debug: raw.debug || {},
  }));
}

export function normalizeBill(bill) {
  const recurrence = bill.recurrence || (bill.frequency === "once" ? "none" : bill.frequency || "monthly");
  const accountRule = bill.accountRule === "offset contribution" ? "offsetContribution" : bill.accountRule || "auto";
  return {
    id: bill.id,
    name: bill.name || "New bill",
    amount: Number(bill.amount || 0),
    lastAmount: Number(bill.lastAmount ?? bill.amount ?? 0),
    category: bill.category || "Other",
    dueDate: bill.dueDate || bill.nextDueDate || "",
    startDate: bill.startDate || bill.dueDate || bill.nextDueDate || "",
    endDate: bill.endDate || bill.finishDate || "",
    recurrence,
    accountRule,
    status: bill.status === "active" ? "confirmed" : bill.status || "confirmed",
    paidBy: bill.paidBy || "",
    amountCovered: Number(bill.amountCovered || 0),
    deferredTo: bill.deferredTo || "",
    auditLog: bill.auditLog || [],
    locked: Boolean(bill.locked),
  };
}

export function getPartnerName(state, partner) {
  if (partner === "A") return state.household.partnerAName || "Carl";
  if (partner === "B") return state.household.partnerBName || "Kim";
  return "Joint";
}

export function getIncome(state, partner) {
  return state.income.find((item) => item.partner === partner) || {};
}

export function getCurrentFortnight(today, anchorDate) {
  const distance = Math.max(0, daysBetween(anchorDate, today));
  const block = Math.floor(distance / 14);
  const start = addDays(anchorDate, block * 14);
  return { start, end: addDays(start, 13), day: daysBetween(start, today) + 1 };
}

export function swanGuard(state, amount = 0) {
  const balanceAfter = Number(state.accounts.offset.balance || 0) - Number(amount || 0);
  const floor = Number(state.accounts.offset.swanFloor || 0);
  return {
    ok: balanceAfter >= floor,
    balanceAfter,
    floor,
    gap: balanceAfter - floor,
    message: balanceAfter >= floor ? "SWAN floor protected" : `Would breach SWAN floor by ${Math.abs(balanceAfter - floor).toFixed(0)}`,
  };
}

export function ensureMortgageEntry(state, today = "2026-04-29") {
  const next = applyFixedRateRollover(normalizeLoanForBalances(deepClone(state), today), today);
  const mortgageBill = next.bills.find((bill) => bill.locked || bill.id.startsWith("mortgage-"));
  const activePaymentDate = mortgageBill?.dueDate && mortgageBill.dueDate > next.loan.nextPaymentDate
    ? mortgageBill.dueDate
    : next.loan.nextPaymentDate;
  next.loan.nextPaymentDate = activePaymentDate;

  const amount = getMortgageRepaymentAmount(next.loan);
  const id = mortgageBill?.id || `mortgage-${activePaymentDate}`;
  const mortgagePatch = {
    id,
    name: "Mortgage repayment",
    amount,
    lastAmount: amount,
    category: "Mortgage",
    dueDate: activePaymentDate,
    startDate: mortgageBill?.startDate || activePaymentDate,
    endDate: "",
    recurrence: next.loan.repaymentFrequency || "fortnightly",
    accountRule: "offset",
    status: "autoAssumed",
    paidBy: getPartnerName(next, next.rules.mortgagePayer || "A"),
    amountCovered: 0,
    deferredTo: "",
    locked: true,
  };

  if (mortgageBill) {
    next.bills = next.bills.map((bill) =>
      bill.id === mortgageBill.id
        ? {
            ...bill,
            ...mortgagePatch,
            auditLog: bill.auditLog || [],
          }
        : bill,
    );
  } else {
    next.bills.push({
      ...mortgagePatch,
      auditLog: [],
    });
  }
  return next;
}
export function getBillVariance(bill) {
  const previous = Number(bill.lastAmount || 0);
  if (previous <= 0) return bill.amount > 0 ? 100 : 0;
  return Math.abs((Number(bill.amount || 0) - previous) / previous) * 100;
}

export function shouldFlagBill(bill, state) {
  if (bill.locked) return "";
  if (bill.status === "partial" || bill.status === "unable to pay" || bill.status === "deferred") return "";
  if (bill.status === "flagged") return "Manual review";
  if (bill.recurrence === "none" && !bill.lastAmount) return "First-time one-off bill";
  const variance = getBillVariance(bill);
  if (variance > Number(state.household.varianceTolerancePercent || 20)) return "Amount moved more than 20% from last cycle";
  return "";
}

export function simulateFortnight(inputState, today) {
  const state = ensureMortgageEntry(inputState, today);
  const window = getCurrentFortnight(today, state.household.fortnightAnchorDate);
  const loanMetrics = calculateLoanMetrics(state);
  const bills = dueInWindow(state.bills, window.start, 14)
    .filter((bill) => bill.status !== "retired")
    .sort((a, b) => {
      if (a.dueDate === b.dueDate && a.locked !== b.locked) return a.locked ? -1 : 1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  const incomeA = getIncome(state, "A");
  const incomeB = getIncome(state, "B");
  let external = Number(state.accounts.externalBalance || 0);
  let offset = Number(state.accounts.offset.balance || 0);
  const log = [];
  let incomeAApplied = false;
  let incomeBApplied = false;

  const rows = bills.map((bill) => {
    if (!incomeAApplied && incomeA.nextPaydate >= window.start && incomeA.nextPaydate <= bill.dueDate && incomeA.route === "offset") {
      offset += Number(incomeA.amount || 0);
      incomeAApplied = true;
      log.push({ date: incomeA.nextPaydate, type: "income", message: `${getPartnerName(state, "A")} income landed in offset`, amount: incomeA.amount });
    }
    if (!incomeBApplied && incomeB.nextPaydate >= window.start && incomeB.nextPaydate <= bill.dueDate && incomeB.route === "external") {
      external += Number(incomeB.amount || 0);
      incomeBApplied = true;
      log.push({ date: incomeB.nextPaydate, type: "income", message: `${getPartnerName(state, "B")} income landed in bills account`, amount: incomeB.amount });
    }

    const amount = getBillAmountRemaining(bill);
    const flagReason = shouldFlagBill(bill, state);
    const dueOrPast = bill.dueDate <= today;
    let status = bill.status;
    let paidBy = bill.paidBy;
    let account = bill.accountRule;
    let note = "";
    let canPay = false;

    if (bill.accountRule === "offsetContribution") {
      offset += amount;
      status = dueOrPast ? "autoAssumed" : status;
      note = "Offset contribution only, not an expense";
    } else if (flagReason) {
      status = "flagged";
      note = flagReason;
    } else if (bill.status === "partial") {
      note = `Part paid, ${amount.toFixed(0)} still open`;
    } else if (bill.status === "unable to pay") {
      note = "Unable-to-pay alert stays open";
    } else if (bill.status === "deferred") {
      note = `Deferred to ${shortDate(bill.deferredTo || bill.dueDate)}`;
    } else if (bill.accountRule === "offset" || bill.locked) {
      const guard = bill.locked ? { ok: true } : swanGuard({ ...state, accounts: { ...state.accounts, offset: { ...state.accounts.offset, balance: offset } } }, amount);
      canPay = offset >= amount && guard.ok;
      if (dueOrPast && canPay) {
        offset -= amount;
        status = "autoAssumed";
        paidBy = bill.locked ? "Offset mortgage" : getPartnerName(state, "A");
        account = "offset";
        note = bill.locked ? "Locked mortgage paid from offset" : "Paid from offset";
      } else {
        status = dueOrPast ? "flagged" : status;
        note = guard.ok ? "Waiting for due date" : guard.message;
      }
    } else {
      canPay = external >= amount;
      if (dueOrPast && canPay) {
        external -= amount;
        status = "autoAssumed";
        paidBy = getPartnerName(state, "B");
        account = "external";
        note = "Kim bill account covered it in date order";
      } else if (dueOrPast) {
        status = "flagged";
        note = "Kim's running balance would go negative";
      } else if (!canPay) {
        status = "flagged";
        note = "Forecast alert: Kim's bill account goes negative before this bill";
      } else {
        note = "Forecast covered by Kim";
      }
    }

    return {
      ...bill,
      amountRemaining: amount,
      simulatedStatus: status,
      paidBy,
      account,
      note,
      externalAfter: external,
      offsetAfter: offset,
    };
  });

  if (!incomeAApplied && incomeA.nextPaydate >= window.start && incomeA.nextPaydate <= window.end && incomeA.route === "offset") {
    offset += Number(incomeA.amount || 0);
    log.push({ date: incomeA.nextPaydate, type: "income", message: `${getPartnerName(state, "A")} income landed in offset`, amount: incomeA.amount });
  }
  if (!incomeBApplied && incomeB.nextPaydate >= window.start && incomeB.nextPaydate <= window.end && incomeB.route === "external") {
    external += Number(incomeB.amount || 0);
    log.push({ date: incomeB.nextPaydate, type: "income", message: `${getPartnerName(state, "B")} income landed in bills account`, amount: incomeB.amount });
  }

  const flagged = rows.filter((row) => row.simulatedStatus === "flagged" || row.simulatedStatus === "partial" || row.simulatedStatus === "unable to pay");
  const dueTotal = rows.filter((row) => row.accountRule !== "offsetContribution").reduce((sum, row) => sum + row.amountRemaining, 0);
  const breathingRoom = Number(incomeA.amount || 0) + Number(incomeB.amount || 0) - dueTotal;
  const swanGap = offset - Number(state.accounts.offset.swanFloor || 0);
  const score = Math.max(0, Math.min(100, Math.round(82 + breathingRoom / 200 + Math.min(10, swanGap / 2500) - flagged.length * 14)));
  const status = flagged.length ? "Action needed" : score >= 75 ? "Safe" : "Tight";

  return {
    window,
    rows,
    log,
    externalAfter: external,
    offsetAfter: offset,
    dueTotal,
    breathingRoom,
    flagged,
    score,
    status,
    loanMetrics,
    swan: {
      gap: swanGap,
      progress: Math.min(100, (offset / Number(state.accounts.offset.swanFloor || 1)) * 100),
      tone: swanGap >= 0 ? "safe" : "issue",
      label: swanGap >= 0 ? "Safe" : "Action needed",
    },
  };
}

export function applyBillPaid(state, billId, today) {
  let next = ensureMortgageEntry(deepClone(state), today);
  const bill = next.bills.find((item) => item.id === billId);
  if (!bill) return next;

  const useOffset = bill.accountRule === "offset" || bill.locked;
  const paidBy = useOffset ? "Offset" : getPartnerName(next, "B");
  const paymentAmount = Number(bill.amount || 0);
  let mortgageEstimate = null;

  if (bill.locked) {
    const result = applyEstimatedMortgageRepayment(next, today);
    next = result.state;
    mortgageEstimate = result.estimate;
  }

  if (useOffset) {
    next.accounts.offset.balance = Math.max(0, Number(next.accounts.offset.balance || 0) - paymentAmount);
    if (next.accounts.offset.balanceStatus === "confirmed") next.accounts.offset.balanceStatus = "estimated";
  } else if (bill.accountRule !== "offsetContribution") {
    next.accounts.externalBalance = Math.max(0, Number(next.accounts.externalBalance || 0) - paymentAmount);
  }

  if (bill.accountRule === "offsetContribution") {
    next.accounts.offset.balance = Number(next.accounts.offset.balance || 0) + paymentAmount;
    if (next.accounts.offset.balanceStatus === "confirmed") next.accounts.offset.balanceStatus = "estimated";
  }

  const nextDue = getNextDueDate(bill);
  if (bill.locked) {
    next.loan.nextPaymentDate = nextDue;
  }

  const estimateSummary = mortgageEstimate
    ? [{
        timestamp: new Date().toISOString(),
        action: `Estimated loan balance reduced by principal ${mortgageEstimate.totalPrincipal.toFixed(2)}; estimated interest ${mortgageEstimate.totalInterest.toFixed(2)}`,
        amount: mortgageEstimate.totalPrincipal,
      }]
    : [];

  const record = {
    id: `paid-${bill.id}-${today}`,
    billId: bill.id,
    name: bill.name,
    amount: paymentAmount,
    paidDate: today,
    paidBy,
    account: bill.accountRule === "auto" ? "external" : bill.accountRule,
    category: bill.category,
    loanEstimate: mortgageEstimate
      ? {
          estimatedInterest: mortgageEstimate.totalInterest,
          estimatedPrincipal: mortgageEstimate.totalPrincipal,
          allocationMode: mortgageEstimate.allocationMode,
          underpayingInterest: mortgageEstimate.underpayingInterest,
        }
      : null,
    auditLog: [
      ...(bill.auditLog || []),
      { timestamp: new Date().toISOString(), action: "Marked paid", amount: bill.amount },
      ...estimateSummary,
    ],
  };

  next.archive = [record, ...(next.archive || [])];
  next = appendFullArchiveRecord(next, record);

  if (bill.recurrence === "none" || (bill.endDate && bill.dueDate >= bill.endDate)) {
    next.bills = next.bills.filter((item) => item.id !== billId);
  } else {
    next.bills = next.bills.map((item) =>
      item.id === billId
        ? {
            ...item,
            dueDate: nextDue,
            lastAmount: item.amount,
            status: item.locked ? "autoAssumed" : "confirmed",
            paidBy: "",
            amountCovered: 0,
            auditLog: [
              ...(item.auditLog || []),
              { timestamp: new Date().toISOString(), action: "Paid and rolled forward", amount: item.amount },
              ...estimateSummary,
            ],
          }
        : item,
    );
  }
  return next;
}
export function deferBill(state, billId, today) {
  const next = deepClone(state);
  const bill = next.bills.find((item) => item.id === billId);
  if (!bill || bill.locked || bill.dueDate < today) return next;
  const nextDate = addDays(bill.dueDate, 14);
  bill.status = "deferred";
  bill.deferredTo = nextDate;
  bill.auditLog = [...(bill.auditLog || []), { timestamp: new Date().toISOString(), action: `Deferred to ${nextDate}`, amount: bill.amount }];
  return next;
}

export function bringBillForward(state, billId, targetDate) {
  const next = deepClone(state);
  next.bills = next.bills.map((bill) =>
    bill.id === billId && !bill.locked
      ? {
          ...bill,
          dueDate: targetDate,
          status: "confirmed",
          deferredTo: "",
          auditLog: [
            ...(bill.auditLog || []),
            { timestamp: new Date().toISOString(), action: `Brought forward to ${targetDate}`, amount: bill.amount },
          ],
        }
      : bill,
  );
  return next;
}

export function getGoLiveChecklist(state) {
  const incomeA = getIncome(state, "A");
  const incomeB = getIncome(state, "B");
  const paydayGap = Math.abs(daysBetween(incomeA.nextPaydate, incomeB.nextPaydate));
  const splitTotal = Number(state.loan.fixed.balance || 0) + Number(state.loan.variable.balance || 0);
  const loanBalance = state.loan.mode === "split" ? splitTotal : Number(state.loan.single.balance || 0);
  const ratesOk =
    state.loan.mode === "split"
      ? Number(state.loan.fixed.rate || 0) > 0 && Number(state.loan.variable.rate || 0) > 0
      : Number(state.loan.single.rate || 0) > 0;
  const items = [
    {
      label: "Household names entered",
      done: Boolean(state.household.householdName && state.household.partnerAName && state.household.partnerBName),
      helper: "Names make partner-facing summaries readable.",
    },
    {
      label: "Both incomes entered",
      done: Number(incomeA.amount || 0) > 0 && Number(incomeB.amount || 0) > 0,
      helper: "Needed for fortnight breathing room.",
    },
    {
      label: "Paydays are staggered",
      done: paydayGap >= 6 && paydayGap <= 8,
      helper: "Carl and Kim should usually be about one week apart.",
    },
    {
      label: "Loan and rates are valid",
      done: loanBalance > 0 && ratesOk && Number(state.loan.repayment || 0) > 0,
      helper: "Needed for interest and mortgage forecasts.",
    },
    {
      label: "SWAN floor is set",
      done: Number(state.accounts.offset.swanFloor || 0) > 0,
      helper: "This protects the offset buffer.",
    },
    {
      label: "Mortgage date is set",
      done: Boolean(state.loan.nextPaymentDate),
      helper: "Creates the locked mortgage bill.",
    },
    {
      label: "At least one bill added",
      done: state.bills.some((bill) => !bill.locked),
      helper: "Needed for Kim's bill waterfall.",
    },
  ];
  return {
    items,
    complete: items.filter((item) => item.done).length,
    total: items.length,
    ready: items.every((item) => item.done),
  };
}

export function getBringForwardCandidates(state, today) {
  const kimCycle = forecastPayCycle(state, "B");
  const cycleIds = new Set(kimCycle.bills.map((bill) => bill.id));
  const candidates = dueInWindow(state.bills, addDays(kimCycle.end, 1), 45)
    .filter((bill) => !bill.locked)
    .filter((bill) => bill.accountRule === "auto" || bill.accountRule === "external")
    .filter((bill) => !cycleIds.has(bill.id))
    .filter((bill) => bill.status !== "partial" && bill.status !== "unable to pay" && bill.status !== "deferred")
    .map((bill) => ({
      ...bill,
      canBringForward: kimCycle.surplus - getBillAmountRemaining(bill) >= 0,
      surplusAfter: kimCycle.surplus - getBillAmountRemaining(bill),
      targetDate: kimCycle.end,
    }));
  return candidates.slice(0, 6);
}

export function buildSuggestions(state, today) {
  const sim = simulateFortnight(state, today);
  return sim.rows
    .filter((row) => !row.locked && row.accountRule !== "offsetContribution")
    .map((row) => {
      if (row.simulatedStatus === "flagged") {
        return {
          tone: "warning",
          text: `${row.name} needs review - ${row.note}`,
          saving: 0,
        };
      }
      const daysHeld = Math.max(0, daysBetween(today, row.dueDate));
      const rate = sim.loanMetrics.weightedRate / 100 / 365;
      return {
        tone: "safe",
        text: `Route ${row.name} through Kim - keeps offset untouched until ${shortDate(row.dueDate)}`,
        saving: row.amountRemaining * rate * daysHeld,
      };
    })
    .sort((a, b) => b.saving - a.saving)
    .slice(0, 5);
}

export function forecastPayCycle(state, partner) {
  const income = getIncome(state, partner);
  const start = income.nextPaydate;
  const end = addDays(start, 13);
  const bills = dueInWindow(state.bills, start, 14).filter((bill) => bill.accountRule !== "offsetContribution");
  const isCarl = partner === "A";
  const startingBalance = isCarl ? Number(state.accounts.offset.balance || 0) : Number(state.accounts.externalBalance || 0);
  const relevantBills = bills.filter((bill) => {
    if (bill.locked) return isCarl;
    if (isCarl) return bill.accountRule === "offset";
    return bill.accountRule === "auto" || bill.accountRule === "external";
  });
  const billTotal = relevantBills.reduce((sum, bill) => sum + getBillAmountRemaining(bill), 0);
  const surplus = Number(income.amount || 0) - billTotal;
  const startingWithIncome = startingBalance + Number(income.amount || 0);
  let runningBalance = startingWithIncome;
  let lowestBalance = runningBalance;
  const running = relevantBills
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((bill) => {
      runningBalance -= getBillAmountRemaining(bill);
      lowestBalance = Math.min(lowestBalance, runningBalance);
      return { ...bill, runningBalance };
    });

  return {
    partner,
    start,
    end,
    income: Number(income.amount || 0),
    startingBalance,
    startingWithIncome,
    bills: running,
    billTotal,
    surplus,
    endingBalance: runningBalance,
    lowestBalance,
    goesNegative: lowestBalance < 0,
    label: isCarl ? "Stays in offset" : "Kim surplus after bills",
    use: isCarl
      ? "This is the amount forecast to remain in offset after mortgage/offset payments in Carl's pay cycle."
      : "This is the amount left in Kim's bill account after her fortnight bills, useful for deciding whether to bring bills forward.",
  };
}
