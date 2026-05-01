import React from "react";
import { currency } from "../logic/financeCalculations";

export default function MetricCard({ label, value, tone = "neutral", detail, money = true }) {
  return (
    <article className={`metric-card ${tone}`}>
      <p>{label}</p>
      <strong>{money ? currency(value) : value}</strong>
      {detail && <span>{detail}</span>}
    </article>
  );
}
