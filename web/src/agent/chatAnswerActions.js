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

export function formatChatAnswerClipboardHtml(text = "") {
  const answer = formatChatAnswerClipboardText(text);
  if (!answer) return "";
  const blocks = [];
  let textLines = [];

  function flushText() {
    if (!textLines.length) return;
    blocks.push(`<div style="white-space:pre-wrap">${escapeClipboardHtml(textLines.join("\n"))}</div>`);
    textLines = [];
  }

  for (const line of answer.split("\n")) {
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushText();
      blocks.push("<hr>");
      continue;
    }
    textLines.push(line);
  }
  flushText();
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
import { normalizeMarkdownDisplayText } from "../utils/markdownTextUtils.js";
