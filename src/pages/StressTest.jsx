import React, { useMemo, useState } from "react";
import MetricCard from "../components/MetricCard";
import { addDays, currency, shortDate } from "../logic/financeCalculations";
import { applyBillPaid, deepClone, simulateFortnight } from "../logic/engine";

function applyIncomeDue(input, date, log) {
  const next = deepClone(input);
  next.income = next.income.map((income) => {
    if (income.nextPaydate && income.nextPaydate <= date) {
      if (income.route === "offset") {
        next.accounts.offset.balance += Number(income.amount || 0);
        if (next.accounts.offset.balanceStatus === "confirmed") next.accounts.offset.balanceStatus = "estimated";
      } else {
        next.accounts.externalBalance += Number(income.amount || 0);
      }
      log.push({
        date: income.nextPaydate,
        type: "income",
        message: `${income.partner === "A" ? "Carl" : "Kim"} income landed in ${income.route === "offset" ? "offset" : "bills account"}`,
      });
      return { ...income, nextPaydate: addDays(income.nextPaydate, 14) };
    }
    return income;
  });
  return next;
}

function advanceClone(input, fromDate, toDate) {
  let state = deepClone(input);
  const log = [];
  let cursor = fromDate;
  while (cursor < toDate) {
    state = applyIncomeDue(state, cursor, log);
    const sim = simulateFortnight(state, cursor);
    sim.rows.filter((row) => row.dueDate <= cursor && row.simulatedStatus === "autoAssumed").forEach((row) => {
      state = applyBillPaid(state, row.id, row.dueDate);
      log.push({ date: cursor, type: "paid", message: `${row.name} auto-assumed paid by ${row.paidBy || row.account}` });
    });
    cursor = addDays(cursor, 1);
  }
  return { state, log, currentDate: toDate };
}

function csv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  return [keys.join(","), ...rows.map((row) => keys.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
}

export default function StressTest({ state, today }) {
  const [clone, setClone] = useState(() => ({ state: deepClone(state), log: [], currentDate: today }));
  const [targetDate, setTargetDate] = useState(addDays(today, 14));
  const sim = useMemo(() => simulateFortnight(clone.state, clone.currentDate), [clone]);
  const auditCsv = useMemo(() => csv(clone.log), [clone.log]);

  const jump = (date) => {
    if (date <= clone.currentDate) return;
    const next = advanceClone(clone.state, clone.currentDate, date);
    setClone({ state: next.state, log: [...clone.log, ...next.log], currentDate: next.currentDate });
    setTargetDate(addDays(date, 14));
  };

  const addShock = (type) => {
    setClone((current) => {
      const next = deepClone(current.state);
      if (type === "rate1") {
        next.loan.fixed.rate += 1;
        next.loan.variable.rate += 1;
        next.loan.single.rate += 1;
      }
      if (type === "income25") next.income.find((income) => income.partner === "B").amount *= 0.75;
      if (type === "car") {
        next.bills.push({
          id: `stress-car-${Date.now()}`,
          name: "Car repayment",
          amount: 620,
          lastAmount: 620,
          category: "Transport",
          dueDate: current.currentDate,
          startDate: current.currentDate,
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
      if (type === "emergency") next.accounts.offset.balance = Math.max(0, next.accounts.offset.balance - 5000);
      return {
        ...current,
        state: next,
        log: [...current.log, { date: current.currentDate, type: "shock", message: `Applied ${type} preset` }],
      };
    });
  };

  const risk = sim.swan.gap < 0 || sim.breathingRoom < 0 ? "High" : sim.breathingRoom < 1000 || sim.flagged.length ? "Medium" : "Low";

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Stress Test</p>
          <h1>Built-in time machine</h1>
          <p className="section-copy">This clones the household, jumps the clock, and logs what the maths did. Live data is untouched.</p>
        </div>
        <span className="pill warning">Simulation only</span>
      </div>

      <div className="metrics-grid">
        <MetricCard label="Sim date" value={shortDate(clone.currentDate)} money={false} />
        <MetricCard label="Breathing room" value={sim.breathingRoom} tone={sim.breathingRoom < 0 ? "issue" : "safe"} />
        <MetricCard label="SWAN gap" value={sim.swan.gap} tone={sim.swan.gap < 0 ? "issue" : "safe"} />
        <MetricCard label="Extra interest / fn" value={sim.loanMetrics.dailyNetInterest * 14} />
        <MetricCard label="Risk level" value={risk} money={false} tone={risk === "High" ? "issue" : risk === "Medium" ? "warning" : "safe"} />
      </div>

      <div className="time-machine-layout">
        <article className="panel">
          <div className="panel-heading"><h2>Clock controls</h2><span>Audit mode</span></div>
          <div className="form-grid compact">
            <label className="field"><span>Jump to date</span><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></label>
          </div>
          <div className="preset-row">
            <button onClick={() => jump(targetDate)}>Jump to date</button>
            <button onClick={() => jump(addDays(clone.currentDate, 14))}>Jump 14 days</button>
            <button onClick={() => jump(addDays(clone.currentDate, 30))}>Jump 30 days</button>
            <button onClick={() => addShock("rate1")}>Rate +1%</button>
            <button onClick={() => addShock("income25")}>Income drop 25%</button>
            <button onClick={() => addShock("car")}>Buy a car</button>
            <button onClick={() => addShock("emergency")}>Emergency $5,000</button>
            <button onClick={() => setClone({ state: deepClone(state), log: [], currentDate: today })}>Reset clone</button>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading"><h2>Audit log</h2><span>{clone.log.length} entries</span></div>
          <div className="sim-log">
            {[...clone.log].reverse().slice(0, 80).map((entry, index) => (
              <div className={`sim-log-row ${entry.type}`} key={`${entry.date}-${index}`}>
                <span>{shortDate(entry.date)}</span>
                <p>{entry.message}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="panel">
        <div className="panel-heading"><h2>Google Sheets audit export</h2><span>CSV preview</span></div>
        <textarea className="csv-preview" readOnly value={auditCsv || "date,type,message\n"} />
      </article>
    </section>
  );
}
