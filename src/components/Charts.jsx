import React from "react";
import { currency } from "../logic/financeCalculations";

const colors = ["#1f7a4d", "#315c9f", "#bc6b1f", "#c93f2d", "#6c5b7b", "#47766f"];

function maxValue(data) {
  return Math.max(1, ...data.map((item) => Number(item.value || 0)));
}

export function DonutChart({ title, data }) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  let offset = 25;
  const visibleData = data.slice(0, 5);

  return (
    <article className="chart-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{currency(total)}</span>
      </div>
      <div className="donut-layout">
        <div className="donut-wrap">
          <svg viewBox="0 0 42 42" className="donut-chart" aria-label={title}>
          <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#e8eeea" strokeWidth="5" />
          {visibleData.map((item, index) => {
            const share = total ? (item.value / total) * 100 : 0;
            const dash = `${share} ${100 - share}`;
            const circle = (
              <circle
                key={item.label}
                cx="21"
                cy="21"
                r="15.9"
                fill="transparent"
                stroke={colors[index % colors.length]}
                strokeWidth="5"
                strokeDasharray={dash}
                strokeDashoffset={offset}
              />
            );
            offset -= share;
            return circle;
          })}
          </svg>
          <div className="donut-center">
            <strong>{visibleData.length}</strong>
            <span>groups</span>
          </div>
        </div>
        <div className="chart-legend">
          {visibleData.map((item, index) => (
            <div key={item.label}>
              <i style={{ background: colors[index % colors.length] }} />
              <span>{item.label}</span>
              <b>{currency(item.value)}</b>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function BarChart({ title, data }) {
  const max = maxValue(data);
  return (
    <article className="chart-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>Peak {currency(max)}</span>
      </div>
      <div className="bar-chart">
        {data.map((item) => (
          <div className="bar-item" key={item.label}>
            <div style={{ height: `${Math.max(5, (item.value / max) * 100)}%` }} />
            <small>{item.label}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

export function LineChart({ title, data, money = true }) {
  const max = maxValue(data);
  const width = 320;
  const height = 128;
  const points = data
    .map((item, index) => {
      const x = data.length === 1 ? 0 : (index / (data.length - 1)) * width;
      const y = height - (Number(item.value || 0) / max) * (height - 14) - 7;
      return `${x},${y}`;
    })
    .join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return (
    <article className="chart-card">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{money ? currency(data[data.length - 1]?.value) : data[data.length - 1]?.value}</span>
      </div>
      <div className="line-chart-wrap">
        <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label={title}>
          <line x1="0" x2={width} y1={height - 8} y2={height - 8} stroke="#e3eae5" strokeWidth="2" />
          <polyline points={area} fill="rgba(31, 122, 77, 0.1)" stroke="none" />
          <polyline points={points} fill="none" stroke="#1f7a4d" strokeWidth="3.4" strokeLinecap="round" />
        </svg>
        <div className="chart-axis">
          <span>Now</span>
          <span>90 days</span>
        </div>
      </div>
    </article>
  );
}

export function ProgressBar({ label, value, detail, tone = "safe" }) {
  return (
    <div className="progress-block">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <div className="progress-track">
        <i className={tone} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}
