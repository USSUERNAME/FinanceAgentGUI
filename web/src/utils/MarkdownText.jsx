import React from "react";
import Terminal from "lucide-react/dist/esm/icons/terminal.js";
import { isMarkdownThematicBreak, normalizeMarkdownDisplayText } from "./markdownTextUtils.js";

export function renderMarkdownInline(text, keyPrefix = "inline") {
  const source = String(text || "");
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\s][^*]*?\*|_[^_\s][^_]*?_)/g;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > cursor) {
      parts.push(
        <React.Fragment key={`${keyPrefix}-text-${cursor}`}>
          {source.slice(cursor, match.index)}
        </React.Fragment>
      );
    }

    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = /^https?:\/\//i.test(link[2]) ? link[2] : "#";
      parts.push(
        <a className="markdown-link" href={href} target="_blank" rel="noreferrer" key={`${keyPrefix}-link-${match.index}`}>
          {link[1]}
        </a>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code className="inline-code" key={`${keyPrefix}-code-${match.index}`}>
          {token.slice(1, -1)}
        </code>
      );
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      parts.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      parts.push(
        <em key={`${keyPrefix}-em-${match.index}`}>
          {token.slice(1, -1)}
        </em>
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < source.length) {
    parts.push(
      <React.Fragment key={`${keyPrefix}-text-${cursor}`}>
        {source.slice(cursor)}
      </React.Fragment>
    );
  }
  return parts.length ? parts : source;
}

function splitMarkdownTableRow(line) {
  const source = String(line || "").trim();
  if (!source.includes("|")) return [];
  const content = source.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  let escaped = false;
  let inInlineCode = false;

  for (const char of content) {
    if (escaped) {
      cell += char === "|" ? "|" : `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "`") {
      inInlineCode = !inInlineCode;
      cell += char;
      continue;
    }
    if (char === "|" && !inInlineCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }

  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function markdownTableAlignments(separatorLine, columnCount) {
  const cells = splitMarkdownTableRow(separatorLine);
  return Array.from({ length: columnCount }, (_, index) => {
    const value = String(cells[index] || "").replace(/\s+/g, "");
    if (/^:-+:$/.test(value)) return "center";
    if (/^-+:$/.test(value)) return "right";
    if (/^:-+$/.test(value)) return "left";
    return "left";
  });
}

function normalizeMarkdownTableRow(cells, columnCount) {
  const normalized = cells.slice(0, columnCount);
  while (normalized.length < columnCount) normalized.push("");
  return normalized;
}

export function MarkdownText({ text, splitSingleLineParagraphs = false }) {
  const lines = normalizeMarkdownDisplayText(text).split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let codeLines = null;
  let codeLanguage = "";

  function parseTableAt(lineIndex) {
    const headerLine = lines[lineIndex];
    const separatorLine = lines[lineIndex + 1];
    if (!headerLine || !separatorLine || !isMarkdownTableSeparator(separatorLine)) return null;
    const headerCells = splitMarkdownTableRow(headerLine);
    if (headerCells.length < 2) return null;
    const columnCount = headerCells.length;
    const rows = [];
    let cursor = lineIndex + 2;

    while (cursor < lines.length) {
      const rowLine = lines[cursor];
      if (!rowLine.trim() || !rowLine.includes("|") || isMarkdownTableSeparator(rowLine)) break;
      const rowCells = splitMarkdownTableRow(rowLine);
      if (rowCells.length < 2) break;
      rows.push(normalizeMarkdownTableRow(rowCells, columnCount));
      cursor += 1;
    }

    return {
      columns: normalizeMarkdownTableRow(headerCells, columnCount),
      alignments: markdownTableAlignments(separatorLine, columnCount),
      rows,
      nextIndex: cursor,
    };
  }

  function flushParagraph() {
    if (!paragraph.length) return;
    const value = paragraph.join("\n").trim();
    if (value) {
      blocks.push(
        <p className="markdown-paragraph" key={`p-${blocks.length}`}>
          {renderMarkdownInline(value, `p-${blocks.length}`)}
        </p>
      );
    }
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    const Tag = list.type === "ol" ? "ol" : "ul";
    const listProps =
      list.type === "ol" && Number.isFinite(list.start) && list.start > 1
        ? { start: list.start }
        : {};
    blocks.push(
      <Tag className="markdown-list" key={`list-${blocks.length}`} {...listProps}>
        {list.items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderMarkdownInline(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  }

  function flushCode() {
    if (!codeLines) return;
    blocks.push(
      <figure className="chat-code markdown-code-block" key={`code-${blocks.length}`}>
        <figcaption>
          <Terminal size={14} strokeWidth={2} />
          <span>{codeLanguage || "text"}</span>
        </figcaption>
        <pre>{codeLines.join("\n")}</pre>
      </figure>
    );
    codeLines = null;
    codeLanguage = "";
  }

  function pushTable(table) {
    blocks.push(
      <div className="chat-table-wrap markdown-table-wrap" key={`table-${blocks.length}`}>
        <table className="chat-table markdown-table">
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th style={{ textAlign: table.alignments[index] }} key={`th-${index}`}>
                  {renderMarkdownInline(column, `table-${blocks.length}-th-${index}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td style={{ textAlign: table.alignments[cellIndex] }} key={`cell-${rowIndex}-${cellIndex}`}>
                    {renderMarkdownInline(cell, `table-${blocks.length}-cell-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (codeLines) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        codeLines = [];
        codeLanguage = fence[1] || "";
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    if (isMarkdownThematicBreak(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr className="markdown-thematic-break" key={`hr-${blocks.length}`} />);
      continue;
    }

    const table = parseTableAt(lineIndex);
    if (table) {
      flushParagraph();
      flushList();
      pushTable(table);
      lineIndex = table.nextIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const headingLevel = heading[1].length;
      const Tag = `h${headingLevel}`;
      blocks.push(
        <Tag className={`markdown-heading markdown-heading-h${headingLevel}`} key={`h-${blocks.length}`}>
          {renderMarkdownInline(heading[2], `h-${blocks.length}`)}
        </Tag>
      );
      continue;
    }

    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const type = ordered ? "ol" : "ul";
      if (!list || list.type !== type) flushList();
      if (!list) {
        list = {
          type,
          start: ordered ? Number(ordered[1]) || 1 : undefined,
          items: [],
        };
      }
      list.items.push(ordered ? ordered[2].trim() : unordered[1].trim());
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote className="markdown-quote" key={`quote-${blocks.length}`}>
          {renderMarkdownInline(quote[1], `quote-${blocks.length}`)}
        </blockquote>
      );
      continue;
    }

    if (splitSingleLineParagraphs && paragraph.length) flushParagraph();
    paragraph.push(line);
    if (splitSingleLineParagraphs) flushParagraph();
  }

  flushParagraph();
  flushList();
  flushCode();

  return <div className="markdown-body">{blocks}</div>;
}
