import React, { useEffect, useMemo, useState } from "react";
import AppShell from "./components/AppShell";
import { blankState, sampleState } from "./data/sampleData";
import Dashboard from "./pages/Dashboard";
import Setup from "./pages/Setup";
import Bills from "./pages/Bills";
import Calendar from "./pages/Calendar";
import LoanDetails from "./pages/LoanDetails";
import Scenarios from "./pages/Scenarios";
import StressTest from "./pages/StressTest";
import Archive from "./pages/Archive";
import { applyBillPaid, bringBillForward, deferBill, ensureMortgageEntry, forecastPayCycle, normalizeState, simulateFortnight } from "./logic/engine";
import { appendActionLog, createStateSnapshot, normalizeAuditTrail } from "./logic/auditTrail";

const today = "2026-04-29";
const storageKey = "household-finance-os";

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    return normalizeAuditTrail(ensureMortgageEntry(normalizeState(stored, sampleState)));
  } catch {
    return normalizeAuditTrail(ensureMortgageEntry(sampleState));
  }
}

function sanitizeBillPatch(patch) {
  const cleanPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(cleanPatch, "name") && !String(cleanPatch.name || "").trim()) {
    cleanPatch.name = "Untitled bill";
  }
  ["amount", "lastAmount", "amountCovered"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(cleanPatch, key)) cleanPatch[key] = Math.max(0, Number(cleanPatch[key] || 0));
  });
  return cleanPatch;
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [state, setState] = useState(() => loadState());
  const sim = useMemo(() => simulateFortnight(state, today), [state]);
  const kimCycle = useMemo(() => forecastPayCycle(state, "B"), [state]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const shortcuts = {
      d: "dashboard",
      b: "bills",
      c: "calendar",
      l: "loan",
      s: "scenarios",
      t: "stress",
      a: "archive",
      u: "setup",
    };
    const handler = (event) => {
      if (event.target?.tagName === "INPUT" || event.target?.tagName === "SELECT" || event.target?.tagName === "TEXTAREA") return;
      const next = shortcuts[event.key.toLowerCase()];
      if (next) setPage(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const updateState = (updater, action = {}) => {
    setState((current) => {
      const before = createStateSnapshot(current);
      const rawNext = typeof updater === "function" ? updater(current) : updater;
      const normalizedNext = normalizeAuditTrail(ensureMortgageEntry(rawNext));
      const after = createStateSnapshot(normalizedNext);
      return appendActionLog(
        normalizedNext,
        {
          type: action.type || "state_update",
          title: action.title || "App data changed",
          detail: action.detail || "Change made from the app UI.",
          source: action.source || page,
          entityType: action.entityType || "",
          entityId: action.entityId || "",
          amount: action.amount,
          date: today,
          force: action.force ?? true,
        },
        before,
        after,
      );
    });
  };

  const updateBill = (id, patch) => {
    const cleanPatch = sanitizeBillPatch(patch);
    updateState((current) => ({
      ...current,
      bills: current.bills.map((bill) => (bill.id === id ? { ...bill, ...cleanPatch, updatedAt: new Date().toISOString() } : bill)),
    }), { type: "bill_updated", title: "Bill edited", entityType: "bill", entityId: id });
  };

  const deleteBill = (id) => {
    updateState((current) => ({
      ...current,
      bills: current.bills.filter((bill) => bill.id !== id || bill.locked),
    }), { type: "bill_deleted", title: "Bill deleted", entityType: "bill", entityId: id });
  };

  const addBill = () => {
    const bill = {
      id: `bill-${Date.now()}`,
      name: "New bill",
      amount: 0,
      lastAmount: 0,
      category: "Other",
      dueDate: today,
      startDate: today,
      endDate: "",
      recurrence: "monthly",
      accountRule: "auto",
      status: "confirmed",
      paidBy: "",
      amountCovered: 0,
      deferredTo: "",
      auditLog: [],
    };
    updateState((current) => ({ ...current, bills: [bill, ...current.bills] }), { type: "bill_added", title: "Bill added", entityType: "bill", entityId: bill.id });
    setPage("bills");
  };

  const markPaid = (billId) => updateState((current) => applyBillPaid(current, billId, today), { type: "bill_paid", title: "Bill marked paid", entityType: "bill", entityId: billId });
  const defer = (billId) => updateState((current) => deferBill(current, billId, today), { type: "bill_deferred", title: "Bill deferred", entityType: "bill", entityId: billId });
  const moveBillForward = (billId, targetDate) => updateState((current) => bringBillForward(current, billId, targetDate), { type: "bill_brought_forward", title: "Bill brought forward", detail: `Moved to ${targetDate}`, entityType: "bill", entityId: billId });
  const clearAllData = () => {
    localStorage.removeItem(storageKey);
    setState(normalizeAuditTrail(ensureMortgageEntry(blankState)));
    setPage("setup");
  };

  const pages = {
    dashboard: <Dashboard state={state} sim={sim} today={today} setPage={setPage} bringBillForward={moveBillForward} />,
    bills: <Bills state={state} sim={sim} updateBill={updateBill} markPaid={markPaid} deferBill={defer} deleteBill={deleteBill} addBill={addBill} today={today} />,
    calendar: <Calendar today={today} state={state} />,
    loan: <LoanDetails state={state} setState={updateState} loanMetrics={sim.loanMetrics} today={today} />,
    scenarios: <Scenarios state={state} today={today} />,
    stress: <StressTest state={state} today={today} />,
    archive: <Archive state={state} today={today} />,
    setup: <Setup state={state} setState={updateState} sim={sim} clearAllData={clearAllData} onComplete={() => setPage("dashboard")} />,
  };

  return (
    <AppShell page={page} setPage={setPage} household={state.household} alertCount={sim.flagged.length + (kimCycle.goesNegative ? 1 : 0)}>
      {pages[page]}
    </AppShell>
  );
}
