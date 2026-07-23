import React, { useEffect, useRef, useState } from "react";
import "./news-feed.css";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import Languages from "lucide-react/dist/esm/icons/languages.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Newspaper from "lucide-react/dist/esm/icons/newspaper.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";

import { formatDateTime } from "../utils/formatters.js";
import { FeedSourceLabel } from "./FeedSourceLabel.jsx";
import { newsFeedClipboardSourceUrl } from "./newsFeedClipboard.js";
import { newsFeedFeeds, newsFeedHealthState, newsFeedStatusLabel } from "./newsFeedStatus.js";

function formatNewsFeedCount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("ko-KR");
}

function translationStatusLabel(status) {
  if (status === "translated") return "번역 완료";
  return "번역 대기";
}

function formatNewsFeedMarketSummaryMeta(summary) {
  if (!summary || typeof summary !== "object") return "";
  const parts = [];
  if (summary.updatedAt) parts.push(`갱신 ${formatDateTime(summary.updatedAt)}`);
  if (Number.isFinite(Number(summary.newsItemsConsidered))) {
    parts.push(`대상 ${formatNewsFeedCount(summary.newsItemsConsidered)}건`);
  }
  const modelLabel = [summary.provider, summary.model].filter(Boolean).join(" · ");
  if (modelLabel) parts.push(modelLabel);
  if (summary.nextBuildAt) parts.push(`다음 ${formatDateTime(summary.nextBuildAt)}`);
  return parts.join(" · ");
}

function marketSummarySeverityDot(summary) {
  const level = String(summary?.alertLevel || "none").trim().toLowerCase();
  if (level === "critical") return { level, label: "critical", className: "is-critical" };
  if (level === "urgent") return { level, label: "urgent", className: "is-urgent" };
  if (level === "watch") return { level, label: "watch", className: "is-watch" };
  return { level: "none", label: "none", className: "is-none" };
}

function displayMarketSummaryText(value) {
  return String(value || "")
    .replace(/\n*\s*심각성\s*평가\s*:\s*[\s\S]*$/u, "")
    .trim();
}

function newsFeedBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("image read failed"));
    reader.readAsDataURL(blob);
  });
}

function loadNewsFeedClipboardImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = source;
  });
}

async function newsFeedImageSrcToDataUrl(source) {
  const response = await fetch(new URL(source, window.location.href).href);
  if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
  return newsFeedBlobToDataUrl(await response.blob());
}

function newsFeedImageClipboardMetrics(sourceImage) {
  const isFeedIcon = sourceImage?.classList?.contains("feed-source-icon");
  const rect = sourceImage?.getBoundingClientRect?.();
  const renderedWidth = isFeedIcon ? 25 : Math.max(1, Math.round(rect?.width || sourceImage?.width || 0));
  const renderedHeight = isFeedIcon ? 25 : Math.max(1, Math.round(rect?.height || sourceImage?.height || 0));
  const style = sourceImage ? window.getComputedStyle(sourceImage) : null;
  const radius = style?.borderRadius || "";
  const isCircle =
    isFeedIcon ||
    radius === "50%" ||
    radius.endsWith("px") && Number.parseFloat(radius) >= Math.min(renderedWidth, renderedHeight) / 2 - 1;
  return {
    renderedWidth,
    renderedHeight,
    isCircle,
  };
}

async function shapeNewsFeedClipboardImage(dataUrl, metrics) {
  if (!metrics.isCircle) return dataUrl;
  const sourceImage = await loadNewsFeedClipboardImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = metrics.renderedWidth;
  canvas.height = metrics.renderedHeight;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
  const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
  const targetRatio = canvas.width / canvas.height;
  const sourceRatio = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else if (sourceRatio < targetRatio) {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  context.save();
  context.beginPath();
  context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2);
  context.clip();
  context.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  context.restore();
  return canvas.toDataURL("image/png");
}

function applyNewsFeedClipboardImageMetrics(image, metrics) {
  image.style.verticalAlign = "middle";
}

async function inlineNewsFeedClipboardImages(sourceNode, cloneNode) {
  const sourceImages = Array.from(sourceNode.querySelectorAll("img"));
  const cloneImages = Array.from(cloneNode.querySelectorAll("img"));
  await Promise.all(
    cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index];
      const source = sourceImage?.currentSrc || sourceImage?.src || image.currentSrc || image.src || image.getAttribute("src");
      if (!source) return;
      const metrics = newsFeedImageClipboardMetrics(sourceImage);
      try {
        const dataUrl = await newsFeedImageSrcToDataUrl(source);
        image.setAttribute("src", await shapeNewsFeedClipboardImage(dataUrl, metrics));
      } catch (error) {
        image.setAttribute("src", new URL(source, window.location.href).href);
        image.setAttribute("data-copy-image-warning", error.message || "image inline failed");
      }
      applyNewsFeedClipboardImageMetrics(image, metrics);
    })
  );
}

function addNewsFeedClipboardUrl(cloneNode, sourceUrl) {
  const url = newsFeedClipboardSourceUrl(sourceUrl);
  if (!url) return;
  const body = cloneNode.querySelector(".news-feed-translation");
  if (!body) return;
  const target = cloneNode.querySelector(".news-feed-original") || body;

  const spacer = document.createElement("p");
  spacer.innerHTML = "&nbsp;";
  const urlParagraph = document.createElement("p");
  const link = document.createElement("a");
  link.href = url;
  link.textContent = url;
  urlParagraph.appendChild(document.createTextNode("Source URL: "));
  urlParagraph.appendChild(link);
  target.insertAdjacentElement("afterend", urlParagraph);
  target.insertAdjacentElement("afterend", spacer);
}

function normalizeNewsFeedClipboardMetaRow(cloneNode) {
  const meta = cloneNode.querySelector(".news-feed-item-meta");
  if (!meta) return;
  const sourceName = meta.querySelector(".feed-source-name")?.textContent.trim() || "";
  const itemTime = meta.querySelector(".news-feed-item-time")?.textContent.trim() || "";
  const image = meta.querySelector("img")?.cloneNode(true);
  const row = document.createElement("p");
  row.className = "news-feed-copy-meta-row";
  row.style.margin = "0";
  row.style.lineHeight = "1.35";
  row.style.whiteSpace = "normal";

  if (image) {
    row.appendChild(image);
    row.appendChild(document.createTextNode(" "));
  }

  const label = document.createElement("strong");
  label.textContent = sourceName;
  label.style.color = "#242424";
  label.style.fontWeight = "700";
  label.style.verticalAlign = "middle";
  if (sourceName) row.appendChild(label);

  if (itemTime) {
    const time = document.createElement("span");
    time.textContent = itemTime;
    time.style.color = "#777777";
    time.style.fontWeight = "700";
    time.style.verticalAlign = "middle";
    if (sourceName) row.appendChild(document.createTextNode(" "));
    row.appendChild(time);
  }
  meta.replaceWith(row);

  const body = cloneNode.querySelector(".news-feed-translation");
  if (body) {
    const spacer = document.createElement("p");
    spacer.innerHTML = "&nbsp;";
    body.insertAdjacentElement("beforebegin", spacer);
  }
}

function newsFeedPlainTextFromNode(node) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  const cloneNode = node.cloneNode(true);
  cloneNode.style.contentVisibility = "visible";
  holder.appendChild(cloneNode);
  document.body.appendChild(holder);
  const text = holder.innerText.trim();
  holder.remove();
  return text;
}

async function buildNewsFeedClipboardPayload(sourceNode, item) {
  if (!sourceNode) throw new Error("복사할 뉴스 항목을 찾지 못했습니다.");
  const cloneNode = sourceNode.cloneNode(true);
  cloneNode.querySelectorAll(".news-feed-copy-button, .news-feed-copy-status").forEach((element) => {
    element.remove();
  });
  normalizeNewsFeedClipboardMetaRow(cloneNode);
  addNewsFeedClipboardUrl(cloneNode, item?.sourceUrl);
  await inlineNewsFeedClipboardImages(sourceNode, cloneNode);
  const plainText = newsFeedPlainTextFromNode(cloneNode);
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

function buildMarketSummaryClipboardPayload(sourceNode, summaryText, summaryMeta) {
  if (!sourceNode) throw new Error("복사할 시장 요약을 찾지 못했습니다.");

  const cloneNode = document.createElement("section");
  cloneNode.className = "news-feed-market-summary-copy";

  const header = document.createElement("p");
  header.style.margin = "0";
  header.style.lineHeight = "1.35";

  const sourceDot = sourceNode.querySelector(".news-feed-market-summary-severity-dot");
  const dot = document.createElement("span");
  dot.textContent = "●";
  dot.style.color = sourceDot ? window.getComputedStyle(sourceDot).backgroundColor : "#777777";
  dot.style.fontSize = "13px";
  dot.style.verticalAlign = "middle";
  header.appendChild(dot);
  header.appendChild(document.createTextNode(" "));

  const title = document.createElement("strong");
  title.textContent = "시장 요약";
  title.style.color = "#202020";
  title.style.fontWeight = "800";
  title.style.verticalAlign = "middle";
  header.appendChild(title);

  if (summaryMeta) {
    const meta = document.createElement("span");
    meta.textContent = summaryMeta;
    meta.style.color = "#777777";
    meta.style.fontSize = "11px";
    meta.style.fontWeight = "660";
    meta.style.verticalAlign = "middle";
    header.appendChild(document.createTextNode(" "));
    header.appendChild(meta);
  }

  const spacer = document.createElement("p");
  spacer.innerHTML = "&nbsp;";
  const body = document.createElement("p");
  body.textContent = summaryText;
  body.style.margin = "0";
  body.style.color = "#262626";
  body.style.fontSize = "16px";
  body.style.fontWeight = "560";
  body.style.lineHeight = "1.55";
  body.style.whiteSpace = "pre-wrap";
  cloneNode.append(header, spacer, body);

  const plainText = newsFeedPlainTextFromNode(cloneNode);
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

async function writeNewsFeedPayloadToClipboard(payloadPromise) {
  if (navigator.clipboard?.write && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": payloadPromise.then(
            ({ html }) => new Blob([html], { type: "text/html" })
          ),
          "text/plain": payloadPromise.then(
            ({ plainText }) => new Blob([plainText], { type: "text/plain" })
          ),
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

async function writeNewsFeedItemToClipboard(sourceNode, item) {
  return writeNewsFeedPayloadToClipboard(buildNewsFeedClipboardPayload(sourceNode, item));
}

async function writeMarketSummaryToClipboard(sourceNode, summaryText, summaryMeta) {
  return writeNewsFeedPayloadToClipboard(
    Promise.resolve(buildMarketSummaryClipboardPayload(sourceNode, summaryText, summaryMeta))
  );
}

export default function NewsFeedView({
  status,
  items,
  busy,
  refreshBusy,
  loadingMore,
  error,
  hasMore,
  translationModelLabel,
  marketSummary,
  marketSummaryCollapsed = true,
  onMarketSummaryCollapsedChange,
  onRefresh,
}) {
  const [copyState, setCopyState] = useState({ itemId: "", status: "idle", error: "" });
  const copyResetTimerRef = useRef(null);
  const collector = status?.collector || {};
  const feeds = newsFeedFeeds(status);
  const healthState = newsFeedHealthState(status);
  const marketSummaryText = displayMarketSummaryText(marketSummary?.text);
  const marketSummaryMeta = formatNewsFeedMarketSummaryMeta(marketSummary);
  const marketSummarySeverity = marketSummarySeverityDot(marketSummary);
  const marketSummaryFallback = marketSummary?.lastError
    ? `시장 요약 갱신이 보류되었습니다. ${marketSummary.lastError}`
    : "아직 표시할 시장 요약이 없습니다.";
  const healthClassName = [
    "news-feed-health",
    healthState.level === "online" ? "is-online" : "",
    healthState.level === "warning" ? "is-warning" : "",
    healthState.isCollecting ? "is-collecting" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const collectionInFlight = Boolean(collector.inFlight);
  const refreshLabel = refreshBusy
    ? "수집 요청 중"
    : collectionInFlight
      ? "백그라운드 수집 중"
      : "수동 수집";
  const summaryCopyActive = copyState.itemId === "market-summary";
  const summaryCopyStatus = summaryCopyActive ? copyState.status : "idle";
  const summaryCopyLabel =
    summaryCopyStatus === "copying"
      ? "복사 중"
      : summaryCopyStatus === "copied"
        ? "복사됨"
        : summaryCopyStatus === "text"
          ? "텍스트 복사됨"
          : summaryCopyStatus === "error"
            ? "복사 실패"
            : "복사";

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  async function copyNewsFeedItem(event, item) {
    if (copyState.status === "copying") return;
    const sourceNode = event.currentTarget.closest(".news-feed-item");
    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    setCopyState({ itemId: item.id, status: "copying", error: "" });
    try {
      const result = await writeNewsFeedItemToClipboard(sourceNode, item);
      setCopyState({ itemId: item.id, status: result.mode === "text" ? "text" : "copied", error: result.warning || "" });
    } catch (error) {
      setCopyState({ itemId: item.id, status: "error", error: error.message || "복사 실패" });
    } finally {
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopyState({ itemId: "", status: "idle", error: "" });
      }, 1600);
    }
  }

  async function copyMarketSummary(event) {
    if (copyState.status === "copying") return;
    const itemId = "market-summary";
    const sourceNode = event.currentTarget.closest(".news-feed-market-summary");
    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    setCopyState({ itemId, status: "copying", error: "" });
    try {
      const result = await writeMarketSummaryToClipboard(
        sourceNode,
        marketSummaryText || marketSummaryFallback,
        marketSummaryMeta || "15분마다 갱신"
      );
      setCopyState({ itemId, status: result.mode === "text" ? "text" : "copied", error: result.warning || "" });
    } catch (error) {
      setCopyState({ itemId, status: "error", error: error.message || "복사 실패" });
    } finally {
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopyState({ itemId: "", status: "idle", error: "" });
      }, 1600);
    }
  }

  return (
    <div className="news-feed-shell">
      <section className="news-feed-board" aria-labelledby="news-feed-title">
        <header className="news-feed-header">
          <div>
            <h1 id="news-feed-title">News Feed</h1>
            <p>
              {newsFeedStatusLabel(status)} · {formatNewsFeedCount(status?.itemCount || 0)}개 저장 · {collector.retentionHours || 24}시간 보관
            </p>
          </div>
          <div className={healthClassName} title={healthState.title}>
            <span className="status-dot" />
            <span>{healthState.pillLabel}</span>
          </div>
          <button
            className={["board-refresh-button", refreshBusy ? "is-loading" : ""].filter(Boolean).join(" ")}
            type="button"
            onClick={onRefresh}
            disabled={refreshBusy || collectionInFlight}
          >
            {refreshBusy ? <LoaderCircle size={16} strokeWidth={2.2} /> : <RefreshCw size={16} strokeWidth={2.2} />}
            <span>{refreshLabel}</span>
          </button>
        </header>

        <div className="news-feed-meta-line">
          <span>최근 수집 {formatDateTime(collector.lastPollFinishedAt)}</span>
          <span>다음 수집 {formatDateTime(collector.nextPollAt)}</span>
          <span>
            {translationModelLabel ||
              (collector.translationModel
                ? `${collector.translationModel} · ${collector.translationReasoning}`
                : "번역 모델 대기")}
          </span>
          <span>{collector.dataPath || "data/news-feed.json"}</span>
        </div>

        {error || collector.lastError ? (
          <div className="news-feed-alert">
            <AlertTriangle size={16} strokeWidth={2.2} />
            <span>{error || collector.lastError}</span>
          </div>
        ) : null}

        <div className="news-feed-sources" aria-label="등록된 RSS 피드">
          {feeds.map((feed) => {
            const feedOk = feed.lastFetchStatus === "ok";
            const feedWarning = feed.enabled !== false && (feed.lastFetchStatus === "error" || feed.lastError);
            const sourceClassName = [
              "news-feed-source",
              feedOk ? "is-online" : "",
              feedWarning ? "is-warning" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div className={sourceClassName} key={feed.id}>
                <span className="status-dot" />
                <FeedSourceLabel feedId={feed.id} title={feed.title} />
                <span>{feed.enabled === false ? "비활성" : feed.lastFetchStatus || "대기"}</span>
                {feed.itemCount !== undefined ? <span>{formatNewsFeedCount(feed.itemCount)}개</span> : null}
              </div>
            );
          })}
        </div>

        {marketSummary ? (
          <section
            className={[
              "news-feed-market-summary",
              marketSummaryCollapsed ? "is-collapsed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label="시장 요약"
          >
            <div className="news-feed-market-summary-header">
              <button
                className="news-feed-market-summary-toggle"
                type="button"
                aria-expanded={!marketSummaryCollapsed}
                aria-controls="news-feed-market-summary-body"
                aria-label={marketSummaryCollapsed ? "시장 요약 펼치기" : "시장 요약 접기"}
                onClick={() => onMarketSummaryCollapsedChange?.(!marketSummaryCollapsed)}
              >
                {marketSummaryCollapsed ? (
                  <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
                )}
                <span
                  className={[
                    "news-feed-market-summary-severity-dot",
                    marketSummarySeverity.className,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={`심각성 ${marketSummarySeverity.label}`}
                  aria-hidden="true"
                />
                <span>시장 요약</span>
              </button>
              {marketSummaryMeta ? <span>{marketSummaryMeta}</span> : <span>15분마다 갱신</span>}
              <button
                className={[
                  "news-feed-copy-button",
                  summaryCopyStatus !== "idle" ? `is-${summaryCopyStatus}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={copyMarketSummary}
                disabled={summaryCopyStatus === "copying"}
                aria-label="시장 요약 복사"
                title={copyState.error && summaryCopyActive ? copyState.error : summaryCopyLabel}
              >
                {summaryCopyStatus === "copying" ? (
                  <LoaderCircle size={14} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
                )}
                <span className="sr-only news-feed-copy-status">{summaryCopyLabel}</span>
              </button>
            </div>
            {!marketSummaryCollapsed ? (
              <p id="news-feed-market-summary-body">{marketSummaryText || marketSummaryFallback}</p>
            ) : null}
          </section>
        ) : null}

        <div className="news-feed-list" aria-label="수집된 News Feed 항목">
          {items.map((item) => {
            const titleOnly = item.itemContentMode === "title-only";
            const bodyText = titleOnly
              ? item.translatedTitle || item.title || "내용 없음"
              : item.translatedText || item.translatedTitle || item.originalText || item.title || "내용 없음";
            const originalTitle = String(item.title || "").trim();
            const originalBody = String(item.originalText || "").trim();
            const showOriginalTitle = originalTitle && originalTitle !== originalBody;
            const translationStatusClass =
              item.translationStatus === "translated" ? "translated" : "pending";
            const itemCopyActive = copyState.itemId === item.id;
            const itemCopyStatus = itemCopyActive ? copyState.status : "idle";
            const itemCopyLabel =
              itemCopyStatus === "copying"
                ? "복사 중"
                : itemCopyStatus === "copied"
                  ? "복사됨"
                  : itemCopyStatus === "text"
                    ? "텍스트 복사됨"
                    : itemCopyStatus === "error"
                      ? "복사 실패"
                      : "복사";

            return (
              <article className="news-feed-item" key={item.id}>
                <div className="news-feed-item-meta">
                  <FeedSourceLabel feedId={item.feedId} title={item.feedTitle} />
                  <span className="news-feed-item-time">{formatDateTime(item.publishedAt || item.fetchedAt)}</span>
                  <button
                    className={[
                      "news-feed-copy-button",
                      itemCopyStatus !== "idle" ? `is-${itemCopyStatus}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    type="button"
                    onClick={(event) => copyNewsFeedItem(event, item)}
                    disabled={itemCopyStatus === "copying"}
                    aria-label={`${item.feedTitle || "뉴스"} 항목 복사`}
                    title={copyState.error && itemCopyActive ? copyState.error : itemCopyLabel}
                  >
                    {itemCopyStatus === "copying" ? (
                      <LoaderCircle size={14} strokeWidth={2.2} aria-hidden="true" />
                    ) : (
                      <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
                    )}
                    <span className="sr-only news-feed-copy-status">{itemCopyLabel}</span>
                  </button>
                  {item.translationStatus && item.translationStatus !== "translated" ? (
                    <span className={`translation-status translation-status-${translationStatusClass}`}>
                      <Languages size={14} strokeWidth={2.1} />
                      {translationStatusLabel(item.translationStatus)}
                    </span>
                  ) : null}
                </div>
                <p className="news-feed-translation">{bodyText}</p>
                {originalTitle || originalBody ? (
                  <details className="news-feed-original">
                    <summary>원문</summary>
                    {showOriginalTitle ? <strong>{originalTitle}</strong> : null}
                    {originalBody ? <p>{originalBody}</p> : null}
                  </details>
                ) : null}
                {item.translationError ? (
                  <p className="news-feed-error-text">{item.translationError}</p>
                ) : null}
              </article>
            );
          })}

          {!items.length && busy ? (
            <div className="news-feed-empty is-loading" role="status">
              <LoaderCircle size={20} strokeWidth={2} />
              <span>최신 News Feed 30건 불러오는 중</span>
            </div>
          ) : null}

          {!items.length && !busy ? (
            <div className="news-feed-empty">
              <Newspaper size={28} strokeWidth={1.8} />
              <span>아직 저장된 피드가 없습니다.</span>
            </div>
          ) : null}
        </div>

        <div className="news-feed-load-state" aria-live="polite">
          {loadingMore ? (
            <>
              <LoaderCircle size={16} strokeWidth={2.2} />
              <span>이전 항목 불러오는 중</span>
            </>
          ) : hasMore ? (
            <span>아래로 스크롤하면 더 불러옵니다.</span>
          ) : items.length ? (
            <span>24시간 보관 범위의 끝입니다.</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
