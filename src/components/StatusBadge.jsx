import React from "react";

export default function StatusBadge({ status }) {
  const tone = {
    active: "safe",
    confirmed: "safe",
    autoAssumed: "safe",
    paid: "safe",
    partial: "warning",
    "unable to pay": "issue",
    flagged: "warning",
    deferred: "warning",
    retired: "muted",
    cancelled: "muted",
  }[status] || "muted";

  return <span className={`status-badge ${tone}`}>{status}</span>;
}
