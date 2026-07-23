import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./reports.css";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";

import { PortfolioEChart } from "../portfolio/PortfolioEChart.jsx";
import { MarkdownText } from "../utils/MarkdownText.jsx";

function reportSearchText(report = {}) {
  return [
    report.title,
    report.category,
    report.summary,
    report.preamble,
    report.author,
    ...(report.tags || []),
    ...(report.sections || []).flatMap((section) => [section.heading, section.body]),
  ]
    .join(" ")
    .toLowerCase();
}

function reportBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

async function reportImageSrcToDataUrl(src) {
  if (!src) return src;
  if (src.startsWith("data:")) return src;
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`이미지를 가져오지 못했습니다. (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("이미지 형식이 아닙니다.");
  return reportBlobToDataUrl(blob);
}

async function inlineReportClipboardImages(sourceNode, cloneNode) {
  const sourceImages = Array.from(sourceNode.querySelectorAll("img"));
  const cloneImages = Array.from(cloneNode.querySelectorAll("img"));
  await Promise.all(
    cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index];
      const source = sourceImage?.currentSrc || sourceImage?.src || image.currentSrc || image.src || image.getAttribute("src");
      if (!source) return;
      try {
        image.setAttribute("src", await reportImageSrcToDataUrl(source));
      } catch (error) {
        image.setAttribute("src", new URL(source, window.location.href).href);
        image.setAttribute("data-copy-image-warning", error.message || "image inline failed");
      }
    })
  );
}

function inlineReportClipboardCanvases(sourceNode, cloneNode) {
  const sourceCanvases = Array.from(sourceNode.querySelectorAll("canvas"));
  const cloneCanvases = Array.from(cloneNode.querySelectorAll("canvas"));
  cloneCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    if (!sourceCanvas) return;
    try {
      const image = document.createElement("img");
      image.src = sourceCanvas.toDataURL("image/png");
      image.alt = canvas.getAttribute("aria-label") || sourceCanvas.getAttribute("aria-label") || "보고서 차트";
      image.width = sourceCanvas.width;
      image.height = sourceCanvas.height;
      canvas.replaceWith(image);
    } catch {
      canvas.remove();
    }
  });
}

function cleanReportClipboardNode(node) {
  node
    .querySelectorAll(".report-document-category, .report-document-header dl, .report-document-summary, .report-document-tags")
    .forEach((element) => element.remove());
  node.querySelectorAll("script, style, button, textarea, input").forEach((element) => element.remove());
  node.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("href", new URL(anchor.getAttribute("href"), window.location.href).href);
  });
  node.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
}

function trimReportClipboardTrailingWhitespace(element) {
  if (element.classList?.contains("report-copy-heading-spacer")) return;
  let current = element.lastChild;
  while (current && current.nodeType === Node.TEXT_NODE && !current.nodeValue.trim()) {
    const previous = current.previousSibling;
    current.remove();
    current = previous;
  }
  if (current?.nodeType === Node.TEXT_NODE) {
    current.nodeValue = current.nodeValue.replace(/[ \t\u00a0]+$/g, "");
  }
}

const reportClipboardBlockLikeSelector = [
  "article",
  "section",
  "div",
  "p",
  "blockquote",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "time",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
].join(", ");

const reportClipboardWhitespaceContainerSelector = [
  "article",
  "section",
  "div",
  "blockquote",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "table",
  "thead",
  "tbody",
  "tr",
].join(", ");

function isReportClipboardBlockLikeNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE && node.matches(reportClipboardBlockLikeSelector);
}

function shouldRemoveReportClipboardWhitespaceTextNode(textNode) {
  if (textNode.nodeValue.trim()) return false;
  const parent = textNode.parentElement;
  if (!parent || parent.closest("pre, code, textarea")) return false;
  if (isReportClipboardBlockLikeNode(textNode.previousSibling)) return true;
  if (isReportClipboardBlockLikeNode(textNode.nextSibling)) return true;
  return parent.matches(reportClipboardWhitespaceContainerSelector);
}

function normalizeReportClipboardTextWhitespace(node) {
  const textNodes = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  textNodes.forEach((textNode) => {
    if (textNode.parentElement?.closest(".report-copy-heading-spacer")) return;
    textNode.nodeValue = textNode.nodeValue.replace(/\u00a0/g, " ");
    if (shouldRemoveReportClipboardWhitespaceTextNode(textNode)) {
      textNode.remove();
    }
  });
  node
    .querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, time")
    .forEach(trimReportClipboardTrailingWhitespace);
}

function stripReportClipboardInternalMarkers(node) {
  node.querySelectorAll(".report-copy-heading-spacer").forEach((element) => {
    element.classList.remove("report-copy-heading-spacer");
    if (!element.getAttribute("class")) {
      element.removeAttribute("class");
    }
  });
}

function createReportClipboardSpacer() {
  const spacer = document.createElement("p");
  spacer.className = "report-copy-spacer";
  spacer.appendChild(document.createElement("br"));
  return spacer;
}

function createReportClipboardHeadingSpacer({ trailingNbsp = false, withLineBreak = false } = {}) {
  const spacer = document.createElement("p");
  spacer.className = "report-copy-heading-spacer";
  spacer.appendChild(document.createTextNode("\u00a0"));
  if (withLineBreak) {
    spacer.appendChild(document.createElement("br"));
    if (trailingNbsp) {
      spacer.appendChild(document.createTextNode("\u00a0"));
    }
  }
  return spacer;
}

function nextReportClipboardElement(element) {
  let next = element.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
    next = next.nextSibling;
  }
  return next?.nodeType === Node.ELEMENT_NODE ? next : null;
}

function addReportClipboardBlockquoteLeadBreak(container) {
  const lead = container.firstElementChild;
  if (!lead?.matches("strong, b")) return false;
  const firstBreak = nextReportClipboardElement(lead);
  if (!firstBreak?.matches("br")) return false;
  const secondBreak = nextReportClipboardElement(firstBreak);
  if (secondBreak?.matches("br")) return true;
  firstBreak.insertAdjacentElement("afterend", document.createElement("br"));
  return true;
}

function insertReportClipboardBlockquoteBreaks(node) {
  node.querySelectorAll(".report-document-body blockquote").forEach((quote) => {
    if (addReportClipboardBlockquoteLeadBreak(quote)) return;
    const firstParagraph = quote.firstElementChild;
    if (firstParagraph?.matches("p")) {
      addReportClipboardBlockquoteLeadBreak(firstParagraph);
    }
  });
}

function insertReportClipboardBreaks(node) {
  node.querySelectorAll(".report-document-header h1").forEach((heading) => {
    heading.insertAdjacentElement("afterend", document.createElement("br"));
  });
  node.querySelectorAll(".report-document-body h2, .report-document-body .markdown-heading").forEach((heading) => {
    heading.insertAdjacentElement("beforebegin", createReportClipboardHeadingSpacer({ trailingNbsp: true, withLineBreak: true }));
    heading.insertAdjacentElement("afterend", createReportClipboardHeadingSpacer());
  });
  insertReportClipboardBlockquoteBreaks(node);
  node
    .querySelectorAll(".report-document-body p, .report-document-body .markdown-paragraph")
    .forEach((paragraph) => {
      if (
        paragraph.classList.contains("report-copy-spacer") ||
        paragraph.classList.contains("report-copy-heading-spacer") ||
        paragraph.closest("blockquote, figure, figcaption")
      ) {
        return;
      }
      const nextElement = nextReportClipboardElement(paragraph);
      if (!nextElement || !nextElement.matches("p, blockquote, ul, ol, .chat-table-wrap, table")) return;
      paragraph.insertAdjacentElement("afterend", createReportClipboardSpacer());
    });
  node.querySelectorAll(".report-document-body blockquote").forEach((quote) => {
    const nextElement = nextReportClipboardElement(quote);
    if (nextElement?.classList?.contains("report-copy-spacer")) return;
    quote.insertAdjacentElement("afterend", createReportClipboardSpacer());
  });
}

function reportPlainTextFromNode(node) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.style.whiteSpace = "pre-wrap";
  const plainTextNode = node.cloneNode(true);
  plainTextNode.querySelectorAll("ul, ol").forEach((list) => {
    const start = list.matches("ol") ? Number(list.getAttribute("start")) || 1 : 1;
    list.style.listStyle = "none";
    list.style.paddingLeft = "0";
    Array.from(list.children).forEach((item, index) => {
      if (!item.matches("li")) return;
      item.insertBefore(document.createTextNode(list.matches("ol") ? `${start + index}. ` : "• "), item.firstChild);
    });
  });
  holder.appendChild(plainTextNode);
  document.body.appendChild(holder);
  const text = holder.innerText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  holder.remove();
  return text;
}

async function buildReportClipboardPayload(sourceNode) {
  if (!sourceNode) throw new Error("복사할 보고서 본문을 찾지 못했습니다.");
  const cloneNode = sourceNode.cloneNode(true);
  cleanReportClipboardNode(cloneNode);
  insertReportClipboardBreaks(cloneNode);
  inlineReportClipboardCanvases(sourceNode, cloneNode);
  await inlineReportClipboardImages(sourceNode, cloneNode);
  normalizeReportClipboardTextWhitespace(cloneNode);
  stripReportClipboardInternalMarkers(cloneNode);
  const plainText = reportPlainTextFromNode(cloneNode);
  const html = [
    "<!doctype html>",
    "<html>",
    "<head><meta charset=\"utf-8\"></head>",
    "<body>",
    cloneNode.outerHTML,
    "</body>",
    "</html>",
  ].join("");
  return { html, plainText };
}

async function writeReportToClipboard(sourceNode) {
  const payloadPromise = buildReportClipboardPayload(sourceNode);
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": payloadPromise.then(({ html }) => new Blob([html], { type: "text/html" })),
          "text/plain": payloadPromise.then(({ plainText }) => new Blob([plainText], { type: "text/plain" })),
        }),
      ]);
      return { mode: "html" };
    } catch (error) {
      const { plainText } = await payloadPromise;
      await navigator.clipboard.writeText(plainText);
      return { mode: "text", warning: error.message || "HTML 복사 실패" };
    }
  }
  const { plainText } = await payloadPromise;
  await navigator.clipboard.writeText(plainText);
  return { mode: "text" };
}

function ReportListItem({ report, selected, onSelect, onDelete, deleting = false }) {
  return (
    <article
      className={selected ? "report-list-item is-selected" : "report-list-item"}
      role="listitem"
    >
      <button
        className="report-list-main"
        type="button"
        onClick={() => onSelect(report.id)}
        aria-current={selected ? "true" : undefined}
      >
        <span className="report-list-item-topline">
          <span>{report.category}</span>
          <time>{report.updatedAt}</time>
        </span>
        <strong>{report.title}</strong>
        <span className="report-list-summary">{report.summary}</span>
      </button>
      <span className="report-list-tags-row">
        <span className="report-list-tags">
          {report.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </span>
        <button
          className="report-delete-button"
          type="button"
          aria-label={`${report.title} 삭제`}
          title="삭제"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(report);
          }}
          disabled={deleting}
        >
          {deleting ? <LoaderCircle size={15} strokeWidth={2.2} /> : <Trash2 size={15} strokeWidth={2.1} />}
        </button>
      </span>
    </article>
  );
}

function ReportSection({ section }) {
  if (section.type === "echarts" && section.option && typeof section.option === "object") {
    return (
      <section className="report-chart-section">
        <h2>{section.heading}</h2>
        {section.body ? <MarkdownText text={section.body} /> : null}
        <div className="report-chart-frame">
          <PortfolioEChart
            option={section.option}
            className="report-echart"
            ariaLabel={section.ariaLabel || `${section.heading} 차트`}
          />
        </div>
      </section>
    );
  }
  return (
    <section>
      <h2>{section.heading}</h2>
      <MarkdownText text={section.body} />
    </section>
  );
}

function ReportsEmptyState({ searchQuery, busy = false, error = "" }) {
  return (
    <div className="report-empty-state">
      {busy ? <LoaderCircle size={24} strokeWidth={1.9} /> : error ? <AlertTriangle size={24} strokeWidth={1.9} /> : <FileText size={24} strokeWidth={1.9} />}
      <strong>{busy ? "보고서 읽는 중" : error ? "보고서 목록 확인 필요" : searchQuery ? "검색 결과 없음" : "보고서 없음"}</strong>
      <p>{busy ? "보고서 목록을 불러오고 있습니다." : error || (searchQuery ? "다른 검색어로 다시 확인하세요." : "보고서가 생성되면 이 영역에 표시됩니다.")}</p>
    </div>
  );
}

function cleanScoutText(value, maxLength = 240) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function parseJsonObjectFromText(text = "") {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeScoutAngle(angle = {}, index = 0) {
  const label = cleanScoutText(angle.label || angle.title || angle.name, 54);
  if (!label) return null;
  return {
    id: cleanScoutText(angle.id || `angle-${index + 1}`, 40),
    label,
    promptFocus: cleanScoutText(angle.promptFocus || angle.focus || angle.description || label, 220),
  };
}

function normalizeScoutIssue(issue = {}, index = 0) {
  const title = cleanScoutText(issue.title || issue.label || issue.name, 80);
  if (!title) return null;
  const angles = Array.isArray(issue.angles)
    ? issue.angles.map(normalizeScoutAngle).filter(Boolean).slice(0, 4)
    : [];
  return {
    id: cleanScoutText(issue.id || `issue-${index + 1}`, 40),
    title,
    kicker: cleanScoutText(issue.kicker || issue.theme || "", 72),
    whyQuiet: cleanScoutText(issue.whyQuiet || issue.quietReason || issue.reason || "", 240),
    signal: cleanScoutText(issue.signal || issue.emergingSignal || "", 260),
    reportPrompt: cleanScoutText(issue.reportPrompt || issue.prompt || title, 260),
    angles: angles.length
      ? angles
      : [
          { id: "market-map", label: "시장 구조", promptFocus: `${title}의 시장 구조와 가치사슬` },
          { id: "company-map", label: "관련 기업", promptFocus: `${title}의 수혜/피해 기업과 관찰 종목` },
          { id: "risk-check", label: "리스크", promptFocus: `${title}가 조용한 이유와 깨질 수 있는 가정` },
        ],
  };
}

function normalizeScoutPayload(payload) {
  const parsed = payload && typeof payload === "object" ? payload : {};
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map(normalizeScoutIssue).filter(Boolean).slice(0, 4)
    : [];
  if (!issues.length) return null;
  return {
    greeting: cleanScoutText(parsed.greeting || parsed.marketGreeting, 180),
    bridge: cleanScoutText(parsed.bridge || parsed.transition, 260),
    sourceNote: cleanScoutText(parsed.sourceNote || parsed.evidenceNote || "", 220),
    issues,
  };
}

function buildScoutPrompt() {
  return [
    "FinanceAgentGUI의 '심심해요' 패널에 띄울 숨은 시장 이슈 후보를 생성하세요.",
    "주어진 참고 근거를 바탕으로, 메인 뉴스에 가려져 아직 조용하지만 점차 중요해질 수 있는 분야/이슈 3~4개를 고르세요.",
    "선정은 의미 기반으로 하며 단순 키워드 매칭이나 제목 나열로 처리하지 마세요.",
    "첫 문장은 오늘 시장 분위기에 맞는 짧은 인사로 시작하세요. 예: '오늘 주식시장은 ... 때문에 별로였지만' 또는 '오늘 주식시장은 ... 이슈로 들떠 있지만'. 단, 실제 컨텍스트에 맞게 자연스럽게 쓰세요.",
    "그 다음 '하지만 아직 사람들이 크게 관심을 갖지 않는 조용한 분야도 있다'는 전환 문장을 만드세요.",
    "각 이슈에는 사용자가 누를 수 있는 세부 리서치 각도 3개를 넣으세요.",
    "보고서 전문을 쓰지 말고, report_artifact를 절대 포함하지 마세요.",
    "아래 JSON 하나만 출력하세요. 마크다운 설명은 금지입니다.",
    JSON.stringify(
      {
        greeting: "시장 분위기 인사 한 문장",
        bridge: "숨은 이슈를 찾아보자는 전환 문장",
        sourceNote: "참고 근거에서 어떤 신호를 읽었는지에 대한 짧은 설명",
        issues: [
          {
            id: "short-id",
            title: "선택 버튼 제목",
            kicker: "짧은 분류 또는 별칭",
            whyQuiet: "왜 아직 메인 뉴스에 덜 잡히는지",
            signal: "조용히 커지는 신호",
            reportPrompt: "보고서 작성 때 중심 질문",
            angles: [
              {
                id: "angle-id",
                label: "세부 선택 버튼",
                promptFocus: "보고서에서 집중할 부분",
              },
            ],
          },
        ],
      },
      null,
      2
    ),
  ].join("\n\n");
}

function buildResearchPrompt(issue, angle) {
  return [
    "저장 가능한 한국어 분석보고서를 작성해 주세요.",
    "",
    "주제:",
    issue.reportPrompt || issue.title,
    "",
    "세부 관심사:",
    angle.promptFocus || angle.label,
    "",
    "작성 방향:",
    "- 제공된 참고 근거를 바탕으로, 메인 뉴스에 가려졌지만 조용히 소리가 커지는 이슈인지 검토해 주세요.",
    "- 작성 과정에서는 로컬 컨텍스트, World Memory, News Feed, 웹 확인, 공식 자료를 내부적으로 대조하되, 최종 보고서는 조사 로그가 아니라 판단과 서사로 읽히게 써 주세요.",
    "- 현재 시장 분위기 속에서 이 주제가 왜 아직 덜 주목받는지, 어떤 신호가 쌓이면 주류 테마가 될 수 있는지 분석해 주세요.",
    "- 관련 산업, 가치사슬, 수혜/피해 기업 유형, 확인할 지표, 반대 시나리오를 분리해 주세요.",
    "- 보고서 서두에는 근거 묶음부터 나열하지 말고 핵심 요약이나 빠른 판단으로 바로 들어가세요.",
    "- 근거가 로컬 컨텍스트에 한정되면 본문에서 필요한 만큼 한계를 짧게 밝히고, 외부 URL이나 원출처 링크는 하단 각주/참고 링크로 모아 주세요.",
    "- 마지막에는 '계속 관찰할지 / 지금은 보류할지 / 추가 확인 후 진입할지' 형태의 명확한 결론을 주세요.",
    "",
    "저장:",
    "보고서 전문을 작성한 뒤, Reports 화면의 저장 스키마에 맞는 report_artifact 코드펜스를 응답 끝에 정확히 하나 포함해 주세요.",
  ].join("\n");
}

function BoredPulseLoader({ agentIcon = "", label = "시장 신호를 읽는 중" }) {
  return (
    <div className="bored-pulse-stage" role="status" aria-live="polite">
      <div className="bored-pulse-cluster" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span className="bored-pulse-logo" style={{ "--pulse-index": index }} key={index}>
            {agentIcon ? <img className="agent-logo-image" src={agentIcon} alt="" /> : <LoaderCircle size={30} strokeWidth={2.1} />}
          </span>
        ))}
      </div>
      <span>{label}</span>
    </div>
  );
}

function BoredScoutPanel({
  agentIcon = "",
  agentProviderLabel = "에이전트",
  scout,
  scoutError,
  selectedIssue,
  stage,
  onChooseIssue,
  onChooseAngle,
  onRetry,
  isSending = false,
}) {
  if (stage === "warming") {
    return <BoredPulseLoader agentIcon={agentIcon} label="참고 근거에서 조용한 신호를 찾는 중" />;
  }

  if (stage === "researching") {
    return <BoredPulseLoader agentIcon={agentIcon} label={`${agentProviderLabel}에게 리서치 요청을 넘기는 중`} />;
  }

  if (stage === "streaming") {
    return (
      <div className="bored-scout bored-scout-streaming">
        <span>리서치 시작</span>
        <h2>좋아요. 오른쪽에서 보고서가 실시간으로 작성되고 있어요.</h2>
        <p>첫 토큰이 도착했습니다. 이제 오른쪽 에이전트 사이드바에서 스트리밍 출력을 따라가면 됩니다.</p>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="bored-scout bored-scout-streaming">
        <span>리서치 완료</span>
        <h2>보고서 작성 흐름이 끝났습니다.</h2>
        <p>저장 가능한 보고서가 생성되었다면 잠시 뒤 글 목록에 반영됩니다.</p>
      </div>
    );
  }

  if (stage === "error" || !scout) {
    return (
      <div className="bored-scout bored-scout-error">
        <span>신호 탐색 실패</span>
        <h2>숨은 이슈 후보를 아직 만들지 못했습니다.</h2>
        <p>{scoutError || "에이전트 응답을 구조화하지 못했습니다."}</p>
        <button type="button" onClick={onRetry}>
          다시 찾아보기
        </button>
      </div>
    );
  }

  if (stage === "choose-angle" && selectedIssue) {
    return (
      <div className="bored-scout">
        <span>{selectedIssue.kicker || "숨은 이슈"}</span>
        <h2>역시! 이런 데 관심이 있으셨군요.</h2>
        <p>
          그럼 우리 한 번 <strong>{selectedIssue.title}</strong>에 대해 자세히 들여다 볼까요? 특히 어떤 부분을
          알아보면 좋겠어요?
        </p>
        <div className="bored-angle-grid" aria-label="리서치 세부 방향">
          {selectedIssue.angles.map((angle) => (
            <button
              className="bored-angle-button"
              type="button"
              disabled={isSending}
              onClick={() => onChooseAngle(angle)}
              key={angle.id}
            >
              <strong>{angle.label}</strong>
              <span>{angle.promptFocus}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bored-scout">
      <span>숨은 이슈 탐색</span>
      <h2>{scout.greeting || "오늘 시장의 큰 소음 뒤쪽을 한번 볼까요?"}</h2>
      <p>{scout.bridge || "아직 사람들이 크게 관심을 갖지 않지만 앞으로 유망해질지도 모르는 분야를 같이 찾아보면 어떨까 해요."}</p>
      {scout.sourceNote ? <p className="bored-source-note">{scout.sourceNote}</p> : null}
      <div className="bored-issue-grid" aria-label="숨은 이슈 후보">
        {scout.issues.map((issue) => (
          <button className="bored-issue-button" type="button" onClick={() => onChooseIssue(issue)} key={issue.id}>
            <span>{issue.kicker || "quiet signal"}</span>
            <strong>{issue.title}</strong>
            <small>{issue.whyQuiet}</small>
            <em>{issue.signal}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReportsView({
  refreshSignal = 0,
  agentIcon = "",
  agentProvider = "codex-cli",
  agentProviderLabel = "에이전트",
  agentOptionsReady = false,
  agentModel = "",
  agentReasoning = "",
  agentApproval = "",
  isSending = false,
  worldMemoryEnabled = false,
  onResearchPrompt,
}) {
  const [reports, setReports] = useState([]);
  const [reportsBusy, setReportsBusy] = useState(true);
  const [reportsError, setReportsError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [deletingReportId, setDeletingReportId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [scoutStage, setScoutStage] = useState("idle");
  const [scout, setScout] = useState(null);
  const [scoutError, setScoutError] = useState("");
  const [selectedScoutIssue, setSelectedScoutIssue] = useState(null);
  const [reportCopyStatus, setReportCopyStatus] = useState("idle");
  const [reportCopyError, setReportCopyError] = useState("");
  const reportDocumentRef = useRef(null);
  const reportCopyResetTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadReports() {
      setReportsBusy(true);
      setReportsError("");
      try {
        const response = await fetch("/api/reports", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        const nextReports = Array.isArray(payload.reports) ? payload.reports : [];
        setReports(nextReports);
        setSelectedReportId((current) => (nextReports.some((report) => report.id === current) ? current : nextReports[0]?.id || ""));
      } catch (error) {
        if (!cancelled) {
          setReports([]);
          setReportsError(error.message || "보고서 목록을 읽지 못했습니다.");
        }
      } finally {
        if (!cancelled) setReportsBusy(false);
      }
    }
    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  useEffect(() => () => {
    if (reportCopyResetTimerRef.current) {
      window.clearTimeout(reportCopyResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (worldMemoryEnabled) return;
    setScoutStage("idle");
    setScout(null);
    setScoutError("");
    setSelectedScoutIssue(null);
  }, [worldMemoryEnabled]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredReports = useMemo(() => {
    if (!normalizedQuery) return reports;
    return reports.filter((report) => reportSearchText(report).includes(normalizedQuery));
  }, [normalizedQuery, reports]);
  const activeReport = filteredReports.find((report) => report.id === selectedReportId) || filteredReports[0] || null;

  useEffect(() => {
    if (reportCopyResetTimerRef.current) {
      window.clearTimeout(reportCopyResetTimerRef.current);
      reportCopyResetTimerRef.current = null;
    }
    setReportCopyStatus("idle");
    setReportCopyError("");
  }, [activeReport?.id]);

  function submitSearch(event) {
    event.preventDefault();
    setSelectedReportId(filteredReports[0]?.id || "");
    setScoutStage("idle");
  }

  const selectReport = useCallback((reportId) => {
    setSelectedReportId(reportId);
    setScoutStage("idle");
  }, []);

  const copyActiveReport = useCallback(async () => {
    if (reportCopyStatus === "copying") return;
    if (reportCopyResetTimerRef.current) {
      window.clearTimeout(reportCopyResetTimerRef.current);
      reportCopyResetTimerRef.current = null;
    }
    setReportCopyStatus("copying");
    setReportCopyError("");
    try {
      const result = await writeReportToClipboard(reportDocumentRef.current);
      setReportCopyStatus(result.mode === "text" ? "text" : "copied");
      setReportCopyError(result.warning || "");
      reportCopyResetTimerRef.current = window.setTimeout(() => {
        setReportCopyStatus("idle");
        setReportCopyError("");
        reportCopyResetTimerRef.current = null;
      }, 2200);
    } catch (error) {
      setReportCopyStatus("error");
      setReportCopyError(error.message || "보고서를 복사하지 못했습니다.");
    }
  }, [reportCopyStatus]);

  const startBoredScout = useCallback(async () => {
    if (!worldMemoryEnabled || !agentOptionsReady) return;
    setScoutStage("warming");
    setScoutError("");
    setSelectedScoutIssue(null);
    try {
      const response = await fetch("/api/codex/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          prompt: buildScoutPrompt(),
          provider: agentProvider,
          model: agentModel,
          reasoning: agentReasoning,
          approval: agentApproval,
          screen: "reports-bored-scout",
          includeWorldMemorySnapshotContext: true,
          includeWorldMemorySearchContext: true,
          forceWorldMemoryVectorSearch: true,
          worldMemoryVectorSearchQuery: "최근 시장 분위기 속 메인 뉴스에 가려진 조용한 유망 분야와 초기 신호",
          includeNewsFeedSearchContext: true,
          includeNewsFeedContext: false,
          includeReportCatalog: false,
          includeSharedMemory: false,
          requireWebSearch: false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const normalized = normalizeScoutPayload(parseJsonObjectFromText(payload.answer || ""));
      if (!normalized) {
        throw new Error("에이전트가 숨은 이슈 후보 JSON을 만들지 못했습니다.");
      }
      setScout(normalized);
      setScoutStage("choose-topic");
    } catch (error) {
      setScoutError(error.message || "숨은 이슈 후보를 만들지 못했습니다.");
      setScoutStage("error");
    }
  }, [
    agentApproval,
    agentModel,
    agentOptionsReady,
    agentProvider,
    agentReasoning,
    worldMemoryEnabled,
  ]);

  const chooseScoutIssue = useCallback((issue) => {
    setSelectedScoutIssue(issue);
    setScoutStage("choose-angle");
  }, []);

  const chooseScoutAngle = useCallback(async (angle) => {
    if (!selectedScoutIssue || !onResearchPrompt || isSending) return;
    setScoutStage("researching");
    setScoutError("");
    const displayText = `숨은 이슈 리서치: ${selectedScoutIssue.title} · ${angle.label}`;
    try {
      const started = await onResearchPrompt({
        promptText: buildResearchPrompt(selectedScoutIssue, angle),
        displayText,
        issue: selectedScoutIssue,
        angle,
        onFirstDelta: () => setScoutStage("streaming"),
        onComplete: () => setScoutStage("done"),
        onError: (error) => {
          setScoutError(error.message || "보고서 리서치 요청에 실패했습니다.");
          setScoutStage("error");
        },
      });
      if (!started) {
        throw new Error("에이전트가 이미 응답 중이거나 아직 준비되지 않았습니다.");
      }
    } catch (error) {
      setScoutError(error.message || "보고서 리서치 요청에 실패했습니다.");
      setScoutStage("error");
    }
  }, [isSending, onResearchPrompt, selectedScoutIssue]);

  const requestDeleteReport = useCallback((report) => {
    if (!report?.id) return;
    setReportsError("");
    setDeleteCandidate(report);
  }, []);

  const cancelDeleteReport = useCallback(() => {
    if (deletingReportId) return;
    setDeleteCandidate(null);
  }, [deletingReportId]);

  const deleteReport = useCallback(async () => {
    const report = deleteCandidate;
    if (!report?.id || deletingReportId) return;

    setDeletingReportId(report.id);
    setReportsError("");
    try {
      const response = await fetch(`/api/reports?id=${encodeURIComponent(report.id)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const nextReports = Array.isArray(payload.reports) ? payload.reports : [];
      setReports(nextReports);
      setSelectedReportId((current) => {
        if (current !== report.id && nextReports.some((item) => item.id === current)) return current;
        return nextReports[0]?.id || "";
      });
      setDeleteCandidate(null);
    } catch (error) {
      setReportsError(error.message || "보고서를 삭제하지 못했습니다.");
    } finally {
      setDeletingReportId("");
    }
  }, [deleteCandidate, deletingReportId]);

  const deleteCandidateBusy = Boolean(deleteCandidate?.id && deletingReportId === deleteCandidate.id);
  const reportCopyLabel =
    reportCopyStatus === "copying"
      ? "복사 중"
      : reportCopyStatus === "copied"
        ? "복사됨"
        : reportCopyStatus === "text"
          ? "텍스트 복사됨"
          : reportCopyStatus === "error"
            ? "복사 실패"
            : "복사하기";

  return (
    <div className="reports-layout">
      <aside className="reports-list-sidebar" aria-label="보고서 글 목록">
        <header className="reports-list-header">
          <h2>
            글 목록 <span>{reportsBusy ? "(스캔 중)" : `(${filteredReports.length} 개)`}</span>
          </h2>
          {worldMemoryEnabled ? (
            <button
              className="reports-bored-button"
              type="button"
              onClick={startBoredScout}
              disabled={!agentOptionsReady || scoutStage === "warming" || scoutStage === "researching"}
            >
              심심해요
            </button>
          ) : null}
        </header>

        <form className="reports-search-form" role="search" onSubmit={submitSearch}>
          <Search size={16} strokeWidth={2.1} aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            placeholder="보고서 검색"
            aria-label="보고서 검색"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </form>

        <div className="reports-list" role="list" aria-label="보고서 목록">
          {reportsError && filteredReports.length ? (
            <div className="reports-list-alert">
              <AlertTriangle size={15} strokeWidth={2.1} />
              <span>{reportsError}</span>
            </div>
          ) : null}
          {filteredReports.map((report) => (
            <ReportListItem
              report={report}
              selected={activeReport?.id === report.id}
              onSelect={selectReport}
              onDelete={requestDeleteReport}
              deleting={deletingReportId === report.id}
              key={report.id}
            />
          ))}
          {!filteredReports.length ? <ReportsEmptyState searchQuery={searchQuery} busy={reportsBusy} error={reportsError} /> : null}
        </div>
      </aside>

      <section className={scoutStage !== "idle" ? "report-reader is-bored" : "report-reader"} aria-label={scoutStage !== "idle" ? "숨은 이슈 탐색" : "보고서 본문"}>
        {scoutStage !== "idle" ? (
          <BoredScoutPanel
            agentIcon={agentIcon}
            agentProviderLabel={agentProviderLabel}
            scout={scout}
            scoutError={scoutError}
            selectedIssue={selectedScoutIssue}
            stage={scoutStage}
            onChooseIssue={chooseScoutIssue}
            onChooseAngle={chooseScoutAngle}
            onRetry={startBoredScout}
            isSending={isSending}
          />
        ) : activeReport ? (
          <article className="report-document" ref={reportDocumentRef}>
            <header className="report-document-header">
              <div>
                <span className="report-document-category">{activeReport.category}</span>
                <h1 className="report-document-title" aria-label={activeReport.title}>
                  <span className="report-document-title-text">{activeReport.title}</span>
                  <button
                    className={[
                      "report-title-copy-button",
                      reportCopyStatus !== "idle" ? `is-${reportCopyStatus}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={copyActiveReport}
                    disabled={reportCopyStatus === "copying"}
                    aria-label={`${activeReport.title} 보고서 복사`}
                    title={reportCopyError || reportCopyLabel}
                  >
                    {reportCopyStatus === "copying" ? (
                      <LoaderCircle size={15} strokeWidth={2.2} aria-hidden="true" />
                    ) : (
                      <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
                    )}
                    <span className="sr-only report-document-copy-status" aria-live="polite">{reportCopyLabel}</span>
                  </button>
                </h1>
              </div>
              <dl>
                <div>
                  <dt>작성</dt>
                  <dd>{activeReport.author}</dd>
                </div>
                <div>
                  <dt>수정</dt>
                  <dd>{activeReport.updatedAt}</dd>
                </div>
              </dl>
            </header>

            <p className="report-document-summary">{activeReport.summary}</p>

            <div className="report-document-tags">
              {activeReport.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>

            <div className="report-document-body">
              {activeReport.preamble ? (
                <div className="report-document-preamble">
                  <MarkdownText text={activeReport.preamble} />
                </div>
              ) : null}
              {activeReport.sections.map((section, index) => (
                <ReportSection key={`${section.heading}-${index}`} section={section} />
              ))}
            </div>
          </article>
        ) : (
          <ReportsEmptyState searchQuery={searchQuery} busy={reportsBusy} error={reportsError} />
        )}
      </section>

      {deleteCandidate ? (
        <div className="report-delete-overlay" role="presentation">
          <div
            className="report-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-delete-dialog-title"
            aria-describedby="report-delete-dialog-description"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent?.isComposing || deleteCandidateBusy) return;
              event.preventDefault();
              event.stopPropagation();
              void deleteReport();
            }}
          >
            <div className="report-delete-dialog-header">
              <span className="report-delete-dialog-icon" aria-hidden="true">
                <Trash2 size={18} strokeWidth={2.1} />
              </span>
              <h2 id="report-delete-dialog-title">보고서 삭제</h2>
            </div>
            <p id="report-delete-dialog-description">삭제하면 이 목록에서 사라집니다.</p>
            <strong className="report-delete-target">{deleteCandidate.title}</strong>
            <div className="report-delete-dialog-actions">
              <button
                className="report-delete-cancel"
                type="button"
                onClick={cancelDeleteReport}
                disabled={deleteCandidateBusy}
              >
                취소
              </button>
              <button
                className="report-delete-confirm"
                type="button"
                onClick={deleteReport}
                disabled={deleteCandidateBusy}
                autoFocus
              >
                {deleteCandidateBusy ? (
                  <>
                    <LoaderCircle size={15} strokeWidth={2.2} />
                    <span>삭제 중</span>
                  </>
                ) : (
                  <span>삭제</span>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
