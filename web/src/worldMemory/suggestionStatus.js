export function normalizeMemoryChangeSuggestionItem(item) {
  if (item && typeof item === "object") {
    const rawStatus = String(item.status || "").trim().toLowerCase();
    const status =
      rawStatus === "watching" || rawStatus === "observing"
        ? "watching"
        : item.handled || rawStatus === "handled" || rawStatus === "completed"
          ? "completed"
          : "open";
    return {
      text: String(item.text || item.body || item.title || "").trim(),
      status,
      handledAt: String(item.handledAt || "").trim(),
    };
  }
  return { text: String(item || "").trim(), status: "open", handledAt: "" };
}

export function worldMemorySuggestionCanAskAgent(item) {
  return normalizeMemoryChangeSuggestionItem(item).status !== "completed";
}
