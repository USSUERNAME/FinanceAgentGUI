import React from "react";

import financialjuiceIcon from "../assets/financialjuice-icon.png";
import walterBloombergIcon from "../assets/walter-bloomberg-icon.png";
import firstSquawkIcon from "../assets/first-squawk-icon.png";
import unusualWhalesIcon from "../assets/unusual-whales-icon.png";
import trumpsTruthIcon from "../assets/trumps-truth-icon.png";
import wallStEngineIcon from "../assets/wall-st-engine-icon.png";

export function feedIconFor(feedId, title) {
  const key = `${feedId || ""} ${title || ""}`.toLowerCase();
  if (key.includes("financialjuice")) return financialjuiceIcon;
  if (key.includes("walter-bloomberg") || key.includes("walter bloomberg") || key.includes("deitaone")) {
    return walterBloombergIcon;
  }
  if (key.includes("first-squawk") || key.includes("first squawk") || key.includes("firstsquawk")) {
    return firstSquawkIcon;
  }
  if (key.includes("unusual-whales") || key.includes("unusual whales") || key.includes("unusual_whales")) {
    return unusualWhalesIcon;
  }
  if (key.includes("wall-st-engine") || key.includes("wall st engine") || key.includes("wallstengine")) {
    return wallStEngineIcon;
  }
  if (key.includes("trumps-truth") || key.includes("trump's truth") || key.includes("trumpstruth")) {
    return trumpsTruthIcon;
  }
  return "";
}

export function FeedSourceLabel({ feedId, title, className = "" }) {
  const label = title || feedId || "출처";
  const icon = feedIconFor(feedId, label);
  return (
    <span className={["feed-source-label", className].filter(Boolean).join(" ")}>
      {icon ? <img className="feed-source-icon" src={icon} alt="" /> : null}
      <span className="feed-source-name">{label}</span>
    </span>
  );
}
