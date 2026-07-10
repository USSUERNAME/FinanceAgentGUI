export function newsFeedContentRevision(snapshot = {}) {
  const explicitRevision = String(snapshot?.contentRevision || "").trim();
  if (explicitRevision) return explicitRevision;

  return [
    Number(snapshot?.itemCount || 0),
    String(snapshot?.latestItemId || "").trim(),
    String(snapshot?.readState?.latestTranslatedAt || "").trim(),
  ].join(":");
}

export function mergeNewsFeedFirstPage(currentItems = [], firstPageItems = []) {
  const nextItems = [];
  const seen = new Set();

  for (const item of [...firstPageItems, ...currentItems]) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nextItems.push(item);
  }

  return nextItems;
}
