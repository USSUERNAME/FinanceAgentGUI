export function normalizeMarkdownDisplayText(text = "") {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?:&nbsp;|&#160;|\u00a0)/gi, " ")
    .split("\n");
  const normalized = [];
  let insideFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim() ? rawLine : "";
    if (/^\s*```/.test(line)) insideFence = !insideFence;
    if (!insideFence) {
      const headingIndex = line.search(/#{1,6}\s+\S/);
      if (headingIndex > 0) {
        const prefix = line.slice(0, headingIndex).trimEnd();
        const heading = line.slice(headingIndex);
        if (prefix) normalized.push(prefix, "");
        normalized.push(heading);
        continue;
      }
    }
    normalized.push(line);
  }

  return normalized.join("\n");
}

export function isMarkdownThematicBreak(line = "") {
  return /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(String(line || ""));
}
