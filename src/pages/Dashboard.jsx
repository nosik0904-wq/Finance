import React, { useMemo, useState } from "react";
import MetricCard from "../components/MetricCard";
import StatusBadge from "../components/StatusBadge";
import { DonutChart, LineChart, ProgressBar } from "../components/Charts";
import { addDays, currency, shortDate } from "../logic/financeCalculations";
import { buildSuggestions, forecastPayCycle, getBringForwardCandidates, getCurrentFortnight, getIncome, getPartnerName } from "../logic/engine";
import { getBillsByCategory, getProjectedOffset, getFreedomDate } from "../logic/reporting";
import { getMortgageRepaymentAmount } from "../logic/loanLogic";

export default function Dashboard({ state, sim, today, setPage, bringBillForward }) {
  const [openTile, setOpenTile] = useState("income");
  const incomeA = getIncome(state, "A");
  const incomeB = getIncome(state, "B");
  const suggestions = useMemo(() => buildSuggestions(state, today), [state, today]);
  const carlCycle = useMemo(() => forecastPayCycle(state, "A"), [state]);
  const kimCycle = useMemo(() => forecastPayCycle(state, "B"), [state]);
  const bringForwardCandidates = useMemo(() => getBringForwardCandidates(state, today), [state, today]);
  const billMix = useMemo(() => getBillsByCategory(state.bills, today), [state.bills, today]);
  const offsetProjection = useMemo(() => getProjectedOffset(state, state.bills, today), [state, today]);
  const freedom = useMemo(() => getFreedomDate(state, sim.loanMetrics), [state, sim.loanMetrics]);
  const mortgageRepayment = getMortgageRepaymentAmount(state.loan);
  const nextMajor = sim.rows.filter((row) => row.accountRule !== "offsetContribution").sort((a, b) => b.amountRemaining - a.amountRemaining)[0];
  const window = getCurrentFortnight(today, state.household.fortnightAnchorDate);
  const heroCopy = sim.flagged.length
    ? `${sim.flagged.length} bill${sim.flagged.length === 1 ? "" : "s"} need a quick check.`
    : `All clear - next bill window runs to ${shortDate(window.end)}.`;

  const drawer = {
    income: (
      <>
        <h2>Fortnight rhythm</h2>
        <p>Carl builds the offset. Kim runs the bill account in due-date order. These forecasts show what is left at the end of each pay cycle.</p>
        <div className="metrics-grid single">
          <MetricCard label={`${getPartnerName(state, "A")} income`} value={incomeA.amount} detail={`Next pay ${shortDate(incomeA.nextPaydate)}`} />
          <MetricCard label={`${getPartnerName(state, "B")} income`} value={incomeB.amount} detail={`Next pay ${shortDate(incomeB.nextPaydate)}`} />
          <MetricCard label={`${getPartnerName(state, "B")} surplus after bills`} value={kimCycle.surplus} detail={`${shortDate(kimCycle.start)} to ${shortDate(kimCycle.end)}`} tone={kimCycle.surplus >= 0 ? "safe" : "issue"} />
          <MetricCard label={`${getPartnerName(state, "A")} staying in offset`} value={carlCycle.surplus} detail={`${shortDate(carlCycle.start)} to ${shortDate(carlCycle.end)}`} tone={carlCycle.surplus >= 0 ? "safe" : "warning"} />
        </div>
        {kimCycle.goesNegative && (
          <div className="inline-warning">
            Alert: {getPartnerName(state, "B")}'s bill account is forecast to go negative this pay cycle. Lowest point: {currency(kimCycle.lowestBalance)}.
          </div>
        )}
        <div className="two-column cycle-forecast">
          <article className="panel compact-panel">
            <div className="panel-heading">
              <h2>{getPartnerName(state, "B")} bill fortnight</h2>
              <span>{currency(kimCycle.surplus)} left</span>
            </div>
            <p>Use this to decide whether a future bill can be brought forward without pushing Kim's bill account negative.</p>
            <div className="cycle-summary">
              <div><span>Starts</span><strong>{currency(kimCycle.startingBalance)}</strong></div>
              <div><span>Pay in</span><strong>{currency(kimCycle.income)}</strong></div>
              <div><span>Bills out</span><strong>{currency(kimCycle.billTotal)}</strong></div>
              <div className={kimCycle.surplus >= 0 ? "good" : "bad"}><span>Left</span><strong>{currency(kimCycle.surplus)}</strong></div>
            </div>
            <div className="item-list">
              {kimCycle.bills.slice(0, 4).map((bill) => (
                <div className="ledger-row" key={`${bill.id}-${bill.dueDate}`}>
                  <div>
                    <strong>{bill.name}</strong>
                    <small>{shortDate(bill.dueDate)} | running balance {currency(bill.runningBalance)}</small>
                  </div>
                  <span>{currency(bill.amount)}</span>
                </div>
              ))}
            </div>
          </article>
          <article className="panel compact-panel">
            <div className="panel-heading">
              <h2>{getPartnerName(state, "A")} offset fortnight</h2>
              <span>{currency(carlCycle.endingBalance)} forecast offset</span>
            </div>
            <p>Use this to see what should stay protected in offset after Carl's pay and mortgage/offset calls.</p>
            <div className="cycle-summary">
              <div><span>Offset now</span><strong>{currency(carlCycle.startingBalance)}</strong></div>
              <div><span>Pay in</span><strong>{currency(carlCycle.income)}</strong></div>
              <div><span>Offset calls</span><strong>{currency(carlCycle.billTotal)}</strong></div>
              <div className="good"><span>Forecast</span><strong>{currency(carlCycle.endingBalance)}</strong></div>
            </div>
            <div className="item-list">
              {carlCycle.bills.slice(0, 4).map((bill) => (
                <div className="ledger-row" key={`${bill.id}-${bill.dueDate}`}>
                  <div>
                    <strong>{bill.name}</strong>
                    <small>{shortDate(bill.dueDate)} | paid from offset</small>
                  </div>
                  <span>{currency(bill.amount)}</span>
                </div>
              ))}
            </div>
          </article>
        </div>
        <article className="panel compact-panel bring-forward-panel">
          <div className="panel-heading">
            <h2>Could bring forward</h2>
            <span>{currency(kimCycle.surplus)} available</span>
          </div>
          <p>These future bills can move into Kim's current bill fortnight if the leftover stays positive.</p>
          <div className="item-list">
            {bringForwardCandidates.length === 0 ? (
              <p className="empty-text">No suitable future bills found yet.</p>
            ) : bringForwardCandidates.map((bill) => (
              <div className="ledger-row" key={`${bill.id}-${bill.dueDate}`}>
                <div>
                  <strong>{bill.name}</strong>
                  <small>{shortDate(bill.dueDate)} | after move: {currency(bill.surplusAfter)}</small>
                </div>
                <button
                  className="mini-action"
                  disabled={!bill.canBringForward}
                  onClick={() => bringBillForward(bill.id, bill.targetDate)}
                >
                  Bring forward
                </button>
              </div>
            ))}
          </div>
        </article>
      </>
    ),
    bills: (
      <>
        <h2>Bills this fortnight</h2>
        <p>Auto-assumed bills only clear after the date-order balance simulation says Kim can cover them. Manual flags stay open.</p>
        <div className="item-list">
          {sim.rows.slice(0, 6).map((row) => (
            <div className={`ledger-row payer-${row.paidBy || "joint"}`} key={`${row.id}-${row.dueDate}`}>
              <div>
                <strong>{row.name}</strong>
                <small>{shortDate(row.dueDate)} | {row.note}</small>
              </div>
              <div className="row-end">
                <span>{currency(row.amountRemaining)}</span>
                <StatusBadge status={row.simulatedStatus} />
              </div>
            </div>
          ))}
        </div>
      </>
    ),
    loan: (
      <>
        <h2>Loan and offset</h2>
        <p>The mortgage is locked, non-deferrable, and paid from offset. Interest-rate changes live in Setup or can be tested safely in Scenarios.</p>
        <div className="metrics-grid single">
          {state.loan.mode === "split" ? (
            <>
              <MetricCard label="Fixed loan" value={state.loan.fixed.balance} detail={`${state.loan.fixed.rate}%`} />
              <MetricCard label="Variable loan" value={state.loan.variable.balance} detail={`${state.loan.variable.rate}% offset linked`} />
            </>
          ) : (
            <MetricCard label="Loan balance" value={state.loan.single.balance} detail={`${state.loan.single.rate}%`} />
          )}
          <MetricCard label="Weighted rate" value={`${sim.loanMetrics.weightedRate.toFixed(2)}%`} money={false} />
          <MetricCard label="Daily net interest" value={sim.loanMetrics.dailyNetInterest} />
          <MetricCard label="Minimum mortgage payment" value={mortgageRepayment} />
        </div>
      </>
    ),
    swan: (
      <>
        <h2>SWAN floor</h2>
        <p>No suggestion, deferral, or stress test is allowed to recommend dipping below this floor.</p>
        <ProgressBar label="Offset comfort buffer" value={sim.swan.progress} detail={`${currency(sim.offsetAfter)} after forecast | floor ${currency(state.accounts.offset.swanFloor)}`} tone={sim.swan.tone} />
      </>
    ),
  }[openTile];

  return (
    <section className="page-stack">
      <div className="hero-dashboard">
        <div>
          <p className="eyebrow">Day {window.day} of 14</p>
          <h1>{sim.status}</h1>
          <p>{heroCopy}</p>
        </div>
        <div className={`health-score ${sim.flagged.length ? "warning" : "safe"}`}>
          <span>Cashflow health</span>
          <strong>{sim.score}</strong>
          <small>{shortDate(window.start)} to {shortDate(window.end)}</small>
        </div>
      </div>

      <div className="rhythm-strip">
        <i style={{ width: `${Math.min(100, (window.day / 14) * 100)}%` }} />
        <span>{getPartnerName(state, "B")} payday {shortDate(incomeB.nextPaydate)}</span>
        <span>{getPartnerName(state, "A")} payday {shortDate(incomeA.nextPaydate)}</span>
        <span>Mortgage {shortDate(state.loan.nextPaymentDate)}</span>
      </div>

      <div className="insight-grid">
        <button className={`insight-tile ${openTile === "income" ? "open" : ""}`} onClick={() => setOpenTile("income")}>
          <span>Income</span>
          <strong>{currency(Number(incomeA.amount || 0) + Number(incomeB.amount || 0))}</strong>
          <small>Combined next fortnight</small>
        </button>
        <button className={`insight-tile ${openTile === "bills" ? "open" : ""}`} onClick={() => setOpenTile("bills")}>
          <span>Bills</span>
          <strong>{currency(sim.dueTotal)}</strong>
          <small>{sim.flagged.length ? `${sim.flagged.length} flagged` : "Covered in forecast"}</small>
        </button>
        <button className={`insight-tile ${openTile === "loan" ? "open" : ""}`} onClick={() => setOpenTile("loan")}>
          <span>Loan</span>
          <strong>{sim.loanMetrics.weightedRate.toFixed(2)}%</strong>
          <small>{currency(sim.loanMetrics.dailyNetInterest)} daily net interest</small>
        </button>
        <button className={`insight-tile ${openTile === "swan" ? "open" : ""}`} onClick={() => setOpenTile("swan")}>
          <span>SWAN</span>
          <strong>{currency(state.accounts.offset.balance)}</strong>
          <small>{sim.swan.gap >= 0 ? `${currency(sim.swan.gap)} headroom` : `${currency(Math.abs(sim.swan.gap))} gap`}</small>
        </button>
      </div>

      <div className="tile-drawer">{drawer}</div>

      <div className="two-column">
        <article className="panel">
          <div className="panel-heading">
            <h2>Top suggestions</h2>
            <span>SWAN checked</span>
          </div>
          <div className="item-list">
            {suggestions.map((suggestion, index) => (
              <div className="ledger-row" key={suggestion.text}>
                <div>
                  <strong>{index + 1}. {suggestion.text}</strong>
                  <small>{suggestion.saving > 0 ? `Estimated interest saving ${currency(suggestion.saving)}` : "No automatic action taken"}</small>
                </div>
                <StatusBadge status={suggestion.tone === "safe" ? "autoAssumed" : "flagged"} />
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Next major bill</h2>
            <button className="link-button" onClick={() => setPage("bills")}>Open ledger</button>
          </div>
          {nextMajor ? (
            <div className="feature-bill">
              <strong>{nextMajor.name}</strong>
              <span>{currency(nextMajor.amountRemaining)}</span>
              <p>{shortDate(nextMajor.dueDate)} | {nextMajor.note}</p>
            </div>
          ) : (
            <p className="empty-text">No bills in this window yet.</p>
          )}
        </article>
      </div>

      <div className="report-grid">
        <LineChart title="Projected offset" data={offsetProjection} />
        <DonutChart title="Bill mix" data={billMix} />
        <article className="chart-card freedom-card">
          <div className="panel-heading">
            <h2>Freedom date</h2>
            <span>{freedom.year}</span>
          </div>
          <strong>{freedom.label}</strong>
          <p>Based on current loan balance, minimum mortgage payment, and net interest after offset.</p>
        </article>
      </div>
    </section>
  );
}
