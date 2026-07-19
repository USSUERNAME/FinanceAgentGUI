export function newsFeedClipboardSourceUrl(sourceUrl) {
  const rawUrl = String(sourceUrl || "").trim();
  if (!rawUrl) return "";

  try {
    const url = new URL(rawUrl);
    if (url.hostname === "x.com" || url.hostname === "www.x.com") {
      url.hostname = "nitter.net";
    }
    return url.href;
  } catch {
    return rawUrl;
  }
}
