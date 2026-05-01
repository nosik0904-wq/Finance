import React, { useMemo } from "react";
import { addDays, currency, getBillOccurrences, shortDate } from "../logic/financeCalculations";
import { getIncome } from "../logic/engine";

function monthLabel(dateKey) {
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(new Date(`${dateKey}T00:00:00`));
}

function buildDays(today, state) {
  const occurrences = state.bills.flatMap((bill) => getBillOccurrences(bill, today, 90));
  const incomeA = getIncome(state, "A");
  const incomeB = getIncome(state, "B");

  return Array.from({ length: 90 }, (_, index) => {
    const date = addDays(today, index);
    const events = occurrences
      .filter((bill) => bill.dueDate === date)
      .map((bill) => ({
        type: bill.locked ? "mortgage" : "bill",
        label: bill.name,
        amount: bill.amount,
        owner: bill.locked || bill.accountRule === "offset" ? "partnerA" : "partnerB",
      }));

    if (date === incomeA.nextPaydate) events.push({ type: "income", label: `${state.household.partnerAName} payday`, amount: incomeA.amount, owner: "partnerA" });
    if (date === incomeB.nextPaydate) events.push({ type: "income", label: `${state.household.partnerBName} payday`, amount: incomeB.amount, owner: "partnerB" });

    const outgoing = events.filter((event) => event.type !== "income").reduce((sum, event) => sum + event.amount, 0);
    return { date, events, outgoing, heavy: events.filter((event) => event.type !== "income").length >= 3 || outgoing >= 2500 };
  });
}

function pressureWeeks(days) {
  return Array.from({ length: 13 }, (_, index) => {
    const week = days.slice(index * 7, index * 7 + 7);
    const outgoing = week.reduce((sum, day) => sum + day.outgoing, 0);
    const billCount = week.reduce((sum, day) => sum + day.events.filter((event) => event.type !== "income").length, 0);
    return { label: `Week ${index + 1}`, outgoing, billCount, warning: outgoing > 4500 || billCount >= 4 };
  }).filter((week) => week.warning);
}

export default function Calendar({ today, state }) {
  const days = useMemo(() => buildDays(today, state), [today, state]);
  const warnings = useMemo(() => pressureWeeks(days), [days]);
  const months = useMemo(
    () =>
      days.reduce((groups, day) => {
        const key = day.date.slice(0, 7);
        if (!groups[key]) groups[key] = { label: monthLabel(day.date), days: [] };
        groups[key].days.push(day);
        return groups;
      }, {}),
    [days],
  );

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">90-day calendar</p>
          <h1>Upcoming money pressure</h1>
          <p className="section-copy">Paydays, mortgage and bill clusters in one partner-friendly scan.</p>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="pressure-strip">
          {warnings.slice(0, 3).map((week) => (
            <div key={week.label}>
              <strong>{week.label} is a pressure week</strong>
              <span>{currency(week.outgoing)} scheduled out across {week.billCount} bills</span>
            </div>
          ))}
        </div>
      )}

      <div className="calendar-legend">
        <span><i className="partnerA" /> Carl / Offset</span>
        <span><i className="partnerB" /> Kim / Bills</span>
        <span><i className="joint" /> Mortgage</span>
        <span><i className="income" /> Payday</span>
      </div>

      <div className="month-stack">
        {Object.entries(months).map(([key, month]) => (
          <section className="month-section" key={key}>
            <div className="month-heading">
              <h2>{month.label}</h2>
              <span>{month.days.filter((day) => day.events.length).length} active days</span>
            </div>
            <div className="calendar-grid">
              {month.days.map((day) => (
                <article className={`day-card ${day.heavy ? "heavy" : ""}`} key={day.date}>
                  <div className="day-head">
                    <strong>{shortDate(day.date)}</strong>
                    {day.heavy && <span>Pressure</span>}
                  </div>
                  <div className="event-dots">
                    {day.events.map((event, index) => <i className={`${event.owner} ${event.type === "mortgage" ? "joint" : event.type}`} key={`${event.label}-${index}`} />)}
                  </div>
                  <div className="event-list">
                    {day.events.length === 0 ? <small>No movement</small> : day.events.map((event, index) => (
                      <div className={`event ${event.type === "mortgage" ? "joint" : event.owner} ${event.type}`} key={`${event.label}-${index}`}>
                        <span>{event.label}</span>
                        <b>{currency(event.amount)}</b>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
