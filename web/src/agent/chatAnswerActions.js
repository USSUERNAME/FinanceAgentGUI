import { normalizeMarkdownDisplayText } from "../utils/markdownTextUtils.js";

function legacyClipboardCopy(answer, documentRef) {
  if (!documentRef?.body || typeof documentRef.execCommand !== "function") return false;
  const textarea = documentRef.createElement("textarea");
  textarea.value = answer;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  documentRef.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = documentRef.execCommand("copy");
  } finally {
    textarea.remove();
  }
  return copied;
}

export function formatChatAnswerClipboardText(text = "") {
  const lines = normalizeMarkdownDisplayText(text)
    .trim()
    .split("\n")
    .map((line) => line.trimEnd());
  const output = [];

  function pushBlankLine() {
    if (output.length && output[output.length - 1] !== "") output.push("");
  }

  for (const rawLine of lines) {
    const line = rawLine.trim() ? rawLine : "";
    if (!line) {
      pushBlankLine();
      continue;
    }
    const isHeading = /^#{1,6}\s+\S/.test(line);
    const isRule = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    if ((isHeading || isRule) && output.length) pushBlankLine();
    output.push(line);
    if (isHeading || isRule) pushBlankLine();
  }

  while (output[0] === "") output.shift();
  while (output[output.length - 1] === "") output.pop();
  return output.join("\n");
}

function escapeClipboardHtml(text = "") {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatChatClipboardInlineHtml(text = "") {
  const source = String(text || "");
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\s][^*]*?\*|_[^_\s][^_]*?_)/g;
  const output = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > cursor) output.push(escapeClipboardHtml(source.slice(cursor, match.index)));
    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = /^https?:\/\//i.test(link[2]) ? link[2] : "#";
      output.push(`<a href="${escapeClipboardHtml(href)}">${escapeClipboardHtml(link[1])}</a>`);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      output.push(`<code>${escapeClipboardHtml(token.slice(1, -1))}</code>`);
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      output.push(`<strong>${escapeClipboardHtml(token.slice(2, -2))}</strong>`);
    } else {
      output.push(`<em>${escapeClipboardHtml(token.slice(1, -1))}</em>`);
    }
    cursor = match.index + token.length;
  }

  if (cursor < source.length) output.push(escapeClipboardHtml(source.slice(cursor)));
  return output.length ? output.join("") : escapeClipboardHtml(source);
}

function splitChatClipboardTableRow(line = "") {
  const source = String(line).trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!source.includes("|")) return [];
  const cells = [];
  let cell = "";
  let escaped = false;
  let inCode = false;
  for (const char of source) {
    if (escaped) {
      cell += char === "|" ? "|" : `\\${char}`;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "`") {
      inCode = !inCode;
      cell += char;
    } else if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function isChatClipboardTableSeparator(line = "") {
  const cells = splitChatClipboardTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

export function formatChatAnswerClipboardHtml(text = "") {
  const answer = formatChatAnswerClipboardText(text);
  if (!answer) return "";
  const lines = answer.split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(formatChatClipboardInlineHtml).join("<br>")}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    const start = list.type === "ol" && list.start > 1 ? ` start="${list.start}"` : "";
    blocks.push(`<${list.type}${start}>${list.items.map((item) => `<li>${formatChatClipboardInlineHtml(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
      continue;
    }

    if (lines[index + 1] && isChatClipboardTableSeparator(lines[index + 1])) {
      flushParagraph();
      flushList();
      const headers = splitChatClipboardTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const cells = splitChatClipboardTableRow(lines[index]);
        if (cells.length < 2) break;
        rows.push(cells);
        index += 1;
      }
      index -= 1;
      blocks.push(`<table><thead><tr>${headers.map((cell) => `<th>${formatChatClipboardInlineHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${formatChatClipboardInlineHtml(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${formatChatClipboardInlineHtml(heading[2])}</h${level}>`);
      if (level === 1) blocks.push("<br>");
      continue;
    }

    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const type = ordered ? "ol" : "ul";
      if (list && list.type !== type) flushList();
      if (!list) list = { type, start: ordered ? Number(ordered[1]) || 1 : 1, items: [] };
      list.items.push(ordered ? ordered[2].trim() : unordered[1].trim());
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${formatChatClipboardInlineHtml(quote[1])}</blockquote>`);
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return `<div>${blocks.join("")}</div>`;
}

export async function writeChatAnswerToClipboard(
  text,
  clipboard = globalThis.navigator?.clipboard,
  documentRef = globalThis.document,
  timeoutMs = 900,
  ClipboardItemCtor = globalThis.ClipboardItem,
  BlobCtor = globalThis.Blob,
) {
  const answer = formatChatAnswerClipboardText(text);
  if (!answer) throw new Error("복사할 답변이 없습니다.");
  if (clipboard?.write && ClipboardItemCtor && BlobCtor) {
    const html = formatChatAnswerClipboardHtml(answer);
    let timeoutId;
    try {
      await Promise.race([
        clipboard.write([
          new ClipboardItemCtor({
            "text/html": new BlobCtor([html], { type: "text/html" }),
            "text/plain": new BlobCtor([answer], { type: "text/plain" }),
          }),
        ]),
        new Promise((_, reject) => {
          timeoutId = globalThis.setTimeout(
            () => reject(new Error("structured clipboard write timed out")),
            timeoutMs,
          );
        }),
      ]);
      return answer;
    } catch {
      // Fall through to writeText and finally the selection-based local fallback.
    } finally {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
    }
  }
  if (clipboard?.writeText) {
    let timeoutId;
    try {
      await Promise.race([
        clipboard.writeText(answer),
        new Promise((_, reject) => {
          timeoutId = globalThis.setTimeout(
            () => reject(new Error("clipboard write timed out")),
            timeoutMs,
          );
        }),
      ]);
      return answer;
    } catch {
      // Browser permission implementations occasionally stall; use the local selection fallback.
    } finally {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
    }
  }
  if (legacyClipboardCopy(answer, documentRef)) return answer;
  throw new Error("이 브라우저에서는 클립보드 복사를 사용할 수 없습니다.");
}
