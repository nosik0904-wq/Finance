import { shortDate } from "./financeCalculations.js";

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  return structuredClone(value ?? {});
}

function uniqueById(items = []) {
  const map = new Map();
  items.filter(Boolean).forEach((item, index) => {
    const id = item.id || `${item.name || item.type || "entry"}-${item.paidDate || item.date || item.timestamp || index}`;
    map.set(id, { ...item, id });
  });
  return Array.from(map.values());
}

function sortArchive(items = []) {
  return uniqueById(items).sort((a, b) => String(b.paidDate || b.date || "").localeCompare(String(a.paidDate || a.date || "")));
}

export function normalizeAuditTrail(state = {}) {
  const next = clone(state);
  const debug = next.debug || {};
  const archive = Array.isArray(next.archive) ? next.archive : [];
  const fullArchive = sortArchive([...(Array.isArray(debug.fullArchive) ? debug.fullArchive : []), ...archive]);

  next.archive = archive;
  next.debug = {
    actionLog: Array.isArray(debug.actionLog) ? debug.actionLog : [],
    fullArchive,
    balanceSnapshots: Array.isArray(debug.balanceSnapshots) ? debug.balanceSnapshots : [],
    localOnly: debug.localOnly !== false,
    lastBackupExportedAt: debug.lastBackupExportedAt || "",
    lastDebugExportedAt: debug.lastDebugExportedAt || "",
    schemaVersion: debug.schemaVersion || 3,
  };

  return next;
}

export function createStateSnapshot(state = {}) {
  const loan = state.loan || {};
  const accounts = state.accounts || {};
  const offset = accounts.offset || {};
  const incomeA = (state.income || []).find((item) => item.partner === "A") || {};
  const incomeB = (state.income || []).find((item) => item.partner === "B") || {};
  const bills = Array.isArray(state.bills) ? state.bills : [];
  return {
    householdName: state.household?.householdName || "",
    partnerAName: state.household?.partnerAName || "",
    partnerBName: state.household?.partnerBName || "",
    setupComplete: Boolean(state.household?.setupComplete),
    incomeA: { amount: safeNumber(incomeA.amount), nextPaydate: incomeA.nextPaydate || "", route: incomeA.route || "" },
    incomeB: { amount: safeNumber(incomeB.amount), nextPaydate: incomeB.nextPaydate || "", route: incomeB.route || "" },
    billCount: bills.length,
    billDigest: bills.slice(0, 20).map((bill) => ({ id: bill.id, name: bill.name, amount: safeNumber(bill.amount), dueDate: bill.dueDate, status: bill.status, accountRule: bill.accountRule })),
    archiveCount: Array.isArray(state.archive) ? state.archive.length : 0,
    fullArchiveCount: Array.isArray(state.debug?.fullArchive) ? state.debug.fullArchive.length : 0,
    actionLogCount: Array.isArray(state.debug?.actionLog) ? state.debug.actionLog.length : 0,
    externalBalance: safeNumber(accounts.externalBalance),
    offsetBalance: safeNumber(offset.balance),
    offsetStatus: offset.balanceStatus || "",
    fixedBalance: safeNumber(loan.fixed?.balance),
    fixedConfirmedBalance: safeNumber(loan.fixed?.confirmedBalance),
    fixedRate: safeNumber(loan.fixed?.rate),
    fixedEndDate: loan.fixed?.fixedEndDate || "",
    fixedStatus: loan.fixed?.status || "",
    variableBalance: safeNumber(loan.variable?.balance),
    variableConfirmedBalance: safeNumber(loan.variable?.confirmedBalance),
    variableRate: safeNumber(loan.variable?.rate),
    singleBalance: safeNumber(loan.single?.balance),
    singleRate: safeNumber(loan.single?.rate),
    repayment: safeNumber(loan.repayment),
    totalLoanBalance: safeNumber(loan.totalBalance),
    loanStatus: loan.balanceStatus || "",
    nextPaymentDate: loan.nextPaymentDate || "",
    nextReconciliationDate: loan.nextReconciliationDate || "",
  };
}

function snapshotChanged(before = {}, after = {}) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function appendActionLog(state = {}, event = {}, before = null, after = null) {
  const next = normalizeAuditTrail(state);
  if (before && after && !snapshotChanged(before, after) && !event.force) return next;

  const timestamp = event.timestamp || new Date().toISOString();
  const entry = {
    id: event.id || `action-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    date: event.date || timestamp.slice(0, 10),
    type: event.type || "state_update",
    title: event.title || "App state updated",
    detail: event.detail || "",
    source: event.source || "app",
    entityType: event.entityType || "",
    entityId: event.entityId || "",
    amount: event.amount === undefined || event.amount === "" ? "" : safeNumber(event.amount),
    before: before || event.before || null,
    after: after || event.after || null,
  };

  next.debug.actionLog = [entry, ...(next.debug.actionLog || [])];

  if (after) {
    const snapshot = {
      id: `snapshot-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      date: entry.date,
      reason: entry.title || entry.type,
      source: entry.source,
      externalBalance: safeNumber(after.externalBalance),
      offsetBalance: safeNumber(after.offsetBalance),
      fixedBalance: safeNumber(after.fixedBalance),
      variableBalance: safeNumber(after.variableBalance),
      totalLoanBalance: safeNumber(after.totalLoanBalance),
      nextPaymentDate: after.nextPaymentDate || "",
      nextReconciliationDate: after.nextReconciliationDate || "",
    };
    next.debug.balanceSnapshots = [snapshot, ...(next.debug.balanceSnapshots || [])].slice(0, 5000);
  }

  return next;
}

export function appendFullArchiveRecord(state = {}, record = {}) {
  const next = normalizeAuditTrail(state);
  next.debug.fullArchive = sortArchive([record, ...(next.debug.fullArchive || [])]);
  return next;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(headers = [], rows = []) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

export function exportFullArchiveCsv(state = {}) {
  const normalized = normalizeAuditTrail(state);
  const headers = ["paidDate", "name", "amount", "category", "paidBy", "account", "billId", "id", "loanPrincipal", "loanInterest"];
  const rows = (normalized.debug.fullArchive || []).map((item) => ({
    paidDate: item.paidDate || item.date || "",
    name: item.name || "",
    amount: safeNumber(item.amount),
    category: item.category || "",
    paidBy: item.paidBy || item.coveredBy || "",
    account: item.account || item.accountRule || "",
    billId: item.billId || "",
    id: item.id || "",
    loanPrincipal: item.loanEstimate?.estimatedPrincipal ?? "",
    loanInterest: item.loanEstimate?.estimatedInterest ?? "",
  }));
  return rowsToCsv(headers, rows);
}

export function exportActionLogCsv(state = {}) {
  const normalized = normalizeAuditTrail(state);
  const headers = ["timestamp", "date", "type", "title", "detail", "source", "entityType", "entityId", "amount", "beforeSummary", "afterSummary"];
  const rows = (normalized.debug.actionLog || []).map((entry) => ({
    timestamp: entry.timestamp || "",
    date: entry.date || "",
    type: entry.type || "",
    title: entry.title || "",
    detail: entry.detail || "",
    source: entry.source || "",
    entityType: entry.entityType || "",
    entityId: entry.entityId || "",
    amount: entry.amount ?? "",
    beforeSummary: entry.before || "",
    afterSummary: entry.after || "",
  }));
  return rowsToCsv(headers, rows);
}

export function exportMortgageActivityCsv(state = {}) {
  const normalized = normalizeAuditTrail(state);
  const headers = ["date", "type", "title", "detail", "amount", "targetSplit", "fromAccount", "bankConfirmed", "status", "id"];
  const rows = (normalized.loan?.activity || []).map((item) => ({
    date: item.date || item.createdDate || "",
    type: item.type || "",
    title: item.title || "",
    detail: item.detail || item.note || "",
    amount: item.amount ?? "",
    targetSplit: item.targetSplit || item.impact?.targetSplit || "",
    fromAccount: item.fromAccount || item.impact?.fromAccount || "",
    bankConfirmed: item.bankConfirmed ?? "",
    status: item.status || "",
    id: item.id || "",
  }));
  return rowsToCsv(headers, rows);
}

export function exportBalanceSnapshotsCsv(state = {}) {
  const normalized = normalizeAuditTrail(state);
  const headers = ["timestamp", "date", "reason", "source", "externalBalance", "offsetBalance", "fixedBalance", "variableBalance", "totalLoanBalance", "nextPaymentDate", "nextReconciliationDate"];
  return rowsToCsv(headers, normalized.debug.balanceSnapshots || []);
}

export function exportDebugBundle(state = {}) {
  const normalized = normalizeAuditTrail(state);
  return {
    exportedAt: new Date().toISOString(),
    note: "NOSIK / Household Finance OS debug bundle. Contains local-only app data, full paid archive, mortgage activity, action log and balance snapshots.",
    summary: createStateSnapshot(normalized),
    state: normalized,
    fullArchive: normalized.debug.fullArchive || [],
    actionLog: normalized.debug.actionLog || [],
    mortgageActivity: normalized.loan?.activity || [],
    balanceSnapshots: normalized.debug.balanceSnapshots || [],
  };
}

export function formatActionLogEntry(entry = {}) {
  const amount = entry.amount !== "" && entry.amount !== undefined ? ` · $${Number(entry.amount || 0).toLocaleString()}` : "";
  const date = entry.date ? shortDate(entry.date) : "No date";
  return `${date} · ${entry.title || entry.type || "Action"}${amount}`;
}
