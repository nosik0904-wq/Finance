import React, { useMemo, useState } from "react";
import MetricCard from "../components/MetricCard";
import { runScenario } from "../logic/scenarios";

const defaultScenario = {
  payRise: 500,
  incomeDrop: 0,
  rateRise: 0.5,
  newRecurringBill: 120,
  schoolFees: 0,
  carLoan: 0,
  offsetWithdrawal: 0,
  emergencyCost: 0,
};

export default function Scenarios({ state, today }) {
  const [scenario, setScenario] = useState(defaultScenario);
  const result = useMemo(() => runScenario(state, scenario, today), [state, scenario, today]);

  const update = (key, value) => setScenario((current) => ({ ...current, [key]: Number(value) }));

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Futures</p>
          <h1>Test decisions without touching live data</h1>
        </div>
      </div>

      <div className="scenario-layout">
        <article className="panel">
          <div className="form-grid compact">
            {Object.keys(scenario).map((key) => (
              <label className="field" key={key}>
                <span>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                <input type="number" value={scenario[key]} onChange={(event) => update(key, event.target.value)} />
              </label>
            ))}
          </div>
        </article>
        <div className="page-stack">
          <div className="metrics-grid single">
            <MetricCard label="New fortnight surplus" value={result.newFortnightSurplus} tone={result.newFortnightSurplus < 0 ? "issue" : "safe"} />
            <MetricCard label="Live breathing room" value={result.liveBreathingRoom} />
            <MetricCard label="SWAN gap" value={result.swanGap} tone={result.swanGap < 0 ? "issue" : "safe"} />
            <MetricCard label="Extra interest per fortnight" value={result.extraInterest} tone={result.extraInterest > 0 ? "warning" : "safe"} />
            <MetricCard label="Risk level" value={result.riskLevel} money={false} tone={result.riskLevel === "High" ? "issue" : result.riskLevel === "Medium" ? "warning" : "safe"} />
          </div>
          <article className={`verdict ${result.riskLevel.toLowerCase()}`}>
            <strong>{result.riskLevel} risk</strong>
            <p>{result.verdict}</p>
          </article>
        </div>
      </div>
    </section>
  );
}
