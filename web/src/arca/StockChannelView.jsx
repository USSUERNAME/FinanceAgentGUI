import React from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.js";
import Bell from "lucide-react/dist/esm/icons/bell.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import CheckCheck from "lucide-react/dist/esm/icons/check-check.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import ChevronsRight from "lucide-react/dist/esm/icons/chevrons-right.js";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.js";
import List from "lucide-react/dist/esm/icons/list.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Reply from "lucide-react/dist/esm/icons/reply.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Send from "lucide-react/dist/esm/icons/send.js";
import Smile from "lucide-react/dist/esm/icons/smile.js";
import Star from "lucide-react/dist/esm/icons/star.js";
import User from "lucide-react/dist/esm/icons/user.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { formatCount } from "../utils/formatters.js";
import {
  createArcaEmoticonCommentPayload,
  MAX_COMBOCON_ITEMS,
  shouldSubmitCommentFromKeyEvent,
} from "./commentComposer.js";

function displayBoardAuthor(author) {
  return String(author || "")
    .replace(/#\d+\b/g, "")
    .trim();
}

function shouldOpenArticleExternally(event) {
  return event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function formatArticleReaderTime(article) {
  const value = article?.timeIso;
  if (!value) return article?.timeLabel || "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return article?.timeLabel || value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatArcaNotificationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ArcaNotificationDialog({
  actionBusy,
  actionError,
  closeButtonRef,
  notificationUrl,
  onClose,
  onMarkAllRead,
  onOpenItem,
  status,
}) {
  const items = Array.isArray(status?.items) ? status.items.filter((item) => item?.unread) : [];
  const unreadCount = Math.max(0, Number(status?.count || 0));
  const loading = Boolean(status?.loading);
  const error = actionError || (status?.ok === false ? status?.error : "");

  return (
    <div className="arca-notification-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="arca-notification-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="arca-notification-title"
        aria-describedby="arca-notification-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="arca-notification-modal-header">
          <div>
            <span className="arca-notification-modal-kicker">
              <Bell size={15} strokeWidth={2.2} aria-hidden="true" />
              아카라이브
            </span>
            <h2 id="arca-notification-title">알림</h2>
            <p id="arca-notification-description">
              {unreadCount > 0 ? `읽지 않은 알림 ${formatCount(unreadCount)}개` : "읽지 않은 알림이 없습니다."}
            </p>
          </div>
          <div className="arca-notification-modal-header-actions">
            <button
              className="arca-notification-read-all"
              type="button"
              onClick={onMarkAllRead}
              disabled={actionBusy || unreadCount === 0}
            >
              {actionBusy ? (
                <LoaderCircle size={15} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
              ) : (
                <CheckCheck size={15} strokeWidth={2.2} aria-hidden="true" />
              )}
              <span>{actionBusy ? "처리 중" : "모두 읽기"}</span>
            </button>
            <button
              className="arca-notification-modal-close"
              type="button"
              onClick={onClose}
              ref={closeButtonRef}
              aria-label="알림 닫기"
              title="닫기"
            >
              <X size={18} strokeWidth={2.3} aria-hidden="true" />
            </button>
          </div>
        </header>

        {error ? (
          <p className="arca-notification-modal-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="arca-notification-list" aria-live="polite">
          {loading && !items.length ? (
            <div className="arca-notification-empty is-loading">
              <LoaderCircle size={20} strokeWidth={2.1} className="is-spinning" aria-hidden="true" />
              <span>알림을 불러오는 중입니다.</span>
            </div>
          ) : items.length ? (
            items.map((item) => (
              <a
                className={item.unread ? "arca-notification-item is-unread" : "arca-notification-item"}
                href={item.targetUrl}
                target="_blank"
                rel="noreferrer"
                key={item.id || item.targetUrl}
                onClick={(event) => onOpenItem(event, item)}
              >
                <span className="arca-notification-unread-dot" aria-label={item.unread ? "읽지 않음" : "읽음"} />
                <span className="arca-notification-item-copy">
                  <strong>{item.title || "알림 대상 글"}</strong>
                  {item.summary && item.summary !== item.title ? <span>{item.summary}</span> : null}
                  <small>
                    {item.channel ? `${item.channel} 채널` : "아카라이브"}
                    {item.author ? ` · ${displayBoardAuthor(item.author)}` : ""}
                    {formatArcaNotificationTime(item.createdAt)
                      ? ` · ${formatArcaNotificationTime(item.createdAt)}`
                      : ""}
                  </small>
                </span>
                {item.isStockChannel ? (
                  <ChevronRight size={17} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <ExternalLink size={16} strokeWidth={2.1} aria-hidden="true" />
                )}
              </a>
            ))
          ) : (
            <div className="arca-notification-empty">
              <CheckCircle2 size={22} strokeWidth={2} aria-hidden="true" />
              <strong>표시할 알림이 없습니다.</strong>
              <span>새 알림이 생기면 이 목록에서 바로 확인할 수 있습니다.</span>
            </div>
          )}
        </div>

        <footer className="arca-notification-modal-footer">
          <span>주식채널 글은 앱 본문으로, 다른 채널 글은 새 탭으로 엽니다.</span>
          <a href={notificationUrl} target="_blank" rel="noreferrer">
            전체 보기
            <ExternalLink size={14} strokeWidth={2.1} aria-hidden="true" />
          </a>
        </footer>
      </section>
    </div>
  );
}

function CommentAvatar({ src }) {
  const [failedSrc, setFailedSrc] = React.useState("");
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <div className="board-comment-avatar" aria-hidden="true">
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <User size={15} strokeWidth={2} />
      )}
    </div>
  );
}

function articleReaderBlocks(article) {
  if (Array.isArray(article?.contentBlocks) && article.contentBlocks.length) return article.contentBlocks;
  const text = String(article?.contentText || article?.description || "").trim();
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph", text: paragraph }));
}

function absoluteTrustedArcaUrl(value, baseUrl) {
  const source = String(value || "").trim();
  if (!source || source.startsWith("#") || /^(?:data:|blob:|javascript:|mailto:|tel:)/i.test(source)) {
    return source;
  }
  try {
    return new URL(source, baseUrl || "https://arca.live/").toString();
  } catch {
    return source;
  }
}

function isTrustedArcaTwemoji(value, baseUrl) {
  const absolute = absoluteTrustedArcaUrl(value, baseUrl);
  try {
    return /^\/node_modules\/twemoji\/assets\/svg\/[0-9a-f-]+\.svg$/i.test(new URL(absolute).pathname);
  } catch {
    return false;
  }
}

function articleImageProxyPath(value) {
  return `/api/arca/article/image?url=${encodeURIComponent(String(value || ""))}`;
}

function articleMediaProxyPath(value) {
  return `/api/arca/media?url=${encodeURIComponent(String(value || ""))}`;
}

function prepareTrustedArcaHtml(html, baseUrl, queueArticleImages) {
  const source = String(html || "");
  if (!queueArticleImages || typeof document === "undefined") return source;
  const template = document.createElement("template");
  template.innerHTML = source;
  template.content.querySelectorAll("img").forEach((image) => {
    const currentSrc = image.getAttribute("src") || "";
    const candidate = image.getAttribute("data-originalurl") || image.getAttribute("data-src") || currentSrc;
    if (!candidate || isTrustedArcaTwemoji(candidate, baseUrl)) return;
    if (currentSrc) image.setAttribute("data-arca-reader-src", currentSrc);
    image.removeAttribute("src");
    image.removeAttribute("srcset");
    image.closest("picture")?.querySelectorAll("source[srcset]").forEach((sourceNode) => {
      sourceNode.removeAttribute("srcset");
    });
  });
  return template.innerHTML;
}

function installTrustedArticleTableScrollers(root) {
  root.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("board-reader-trusted-table-scroll")) return;
    const scroller = document.createElement("div");
    scroller.className = "board-reader-trusted-table-scroll";
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", "게시글 표");
    scroller.tabIndex = 0;
    table.before(scroller);
    scroller.append(table);
  });
}

function installTrustedArticleVideoMedia(root, baseUrl) {
  root.querySelectorAll("video").forEach((video) => {
    [video, ...video.querySelectorAll("source")].forEach((mediaNode) => {
      const source = absoluteTrustedArcaUrl(mediaNode.getAttribute("src"), baseUrl);
      if (/^https?:\/\//i.test(source)) mediaNode.setAttribute("src", articleMediaProxyPath(source));
    });
    const poster = absoluteTrustedArcaUrl(video.getAttribute("poster"), baseUrl);
    if (/^https?:\/\//i.test(poster)) video.setAttribute("poster", articleMediaProxyPath(poster));
  });
}

function installQueuedArticleImages(root, baseUrl) {
  const cleanupTasks = [];
  const queue = [];

  root.querySelectorAll("img").forEach((sourceImage) => {
    const sourceValue =
      sourceImage.getAttribute("data-originalurl") ||
      sourceImage.getAttribute("data-src") ||
      sourceImage.getAttribute("data-arca-reader-src") ||
      sourceImage.getAttribute("src") ||
      "";
    if (!sourceValue || isTrustedArcaTwemoji(sourceValue, baseUrl)) return;

    const displayValue =
      sourceImage.getAttribute("data-src") ||
      sourceImage.getAttribute("data-arca-reader-src") ||
      sourceImage.getAttribute("src") ||
      sourceValue;
    const displayUrl = absoluteTrustedArcaUrl(displayValue, baseUrl);
    const originalUrl = absoluteTrustedArcaUrl(sourceValue, baseUrl);
    if (!/^https?:\/\//i.test(displayUrl)) return;

    const figure = document.createElement("figure");
    figure.className = "board-reader-figure is-waiting";
    figure.setAttribute("aria-label", "게시글 이미지 로딩 대기");
    figure.dataset.arcaReaderImageIndex = String(queue.length);

    const status = document.createElement("div");
    status.className = "board-reader-image-status";
    const statusText = document.createElement("span");
    statusText.textContent = "앞 이미지 로딩 후 불러옵니다";
    status.append(statusText);

    const image = document.createElement("img");
    image.alt = sourceImage.getAttribute("alt") || "게시글 이미지";
    image.decoding = "async";
    figure.append(status, image);
    sourceImage.replaceWith(figure);

    queue.push({
      displayUrl: articleImageProxyPath(displayUrl),
      figure,
      image,
      originalUrl,
      status,
      statusText,
    });
  });

  const activate = (index) => {
    const item = queue[index];
    if (!item) return;
    let settled = false;
    item.figure.className = "board-reader-figure is-loading";
    item.figure.setAttribute("aria-label", "게시글 이미지 로딩 중");
    item.status.setAttribute("role", "status");
    item.statusText.textContent = "이미지를 불러오는 중입니다";
    const spinner = document.createElement("span");
    spinner.className = "board-reader-image-spinner is-spinning";
    spinner.setAttribute("aria-hidden", "true");
    item.status.prepend(spinner);

    const settle = (nextStatus) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      item.image.removeEventListener("load", handleLoad);
      item.image.removeEventListener("error", handleError);
      if (nextStatus === "loaded") {
        item.figure.className = "board-reader-figure is-loaded";
        item.figure.removeAttribute("aria-label");
        item.status.remove();
      } else {
        item.figure.className = "board-reader-figure is-error";
        item.figure.setAttribute("aria-label", "게시글 이미지 로딩 실패");
        item.status.className = "board-reader-image-status is-error";
        item.status.setAttribute("role", "alert");
        item.status.replaceChildren();
        const message = document.createElement("span");
        message.textContent = "이미지를 불러오지 못했습니다.";
        item.status.append(message);
        if (item.originalUrl) {
          const link = document.createElement("a");
          link.href = item.originalUrl;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = "원본 이미지 열기";
          item.status.append(link);
        }
      }
      activate(index + 1);
    };
    const handleLoad = () => settle("loaded");
    const handleError = () => settle("error");
    const timeoutId = window.setTimeout(handleError, ARTICLE_READER_IMAGE_TIMEOUT_MS);
    item.image.addEventListener("load", handleLoad);
    item.image.addEventListener("error", handleError);
    item.image.src = item.displayUrl;
    cleanupTasks.push(() => {
      window.clearTimeout(timeoutId);
      item.image.removeEventListener("load", handleLoad);
      item.image.removeEventListener("error", handleError);
    });
  };

  activate(0);
  return () => cleanupTasks.forEach((cleanup) => cleanup());
}

const TrustedArcaHtml = React.memo(function TrustedArcaHtml({ html, baseUrl, className, queueArticleImages = false }) {
  const rootRef = React.useRef(null);
  const appliedHtmlRef = React.useRef("");
  const renderedHtml = React.useMemo(
    () => prepareTrustedArcaHtml(html, baseUrl, queueArticleImages),
    [baseUrl, html, queueArticleImages]
  );

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const renderKey = `${queueArticleImages ? "queued-images" : "direct-images"}\n${baseUrl || ""}\n${html || ""}`;
    if (!root || appliedHtmlRef.current === renderKey) return;
    appliedHtmlRef.current = renderKey;

    installTrustedArticleTableScrollers(root);

    const urlAttributes = ["src", "href", "poster", "action", "data-src", "data-originalurl", "data-arca-reader-src"];
    root.querySelectorAll("[src], [href], [poster], [action], [data-src], [data-originalurl], [data-arca-reader-src]").forEach((element) => {
      urlAttributes.forEach((attribute) => {
        if (!element.hasAttribute(attribute)) return;
        const currentValue = element.getAttribute(attribute);
        const absoluteValue = absoluteTrustedArcaUrl(currentValue, baseUrl);
        if (absoluteValue && absoluteValue !== currentValue) element.setAttribute(attribute, absoluteValue);
      });
    });

    installTrustedArticleVideoMedia(root, baseUrl);

    root.querySelectorAll("a[href]").forEach((anchor) => {
      if (!anchor.getAttribute("target")) anchor.setAttribute("target", "_blank");
      if (anchor.getAttribute("target") === "_blank") {
        const rel = new Set(String(anchor.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
        rel.add("noreferrer");
        anchor.setAttribute("rel", [...rel].join(" "));
      }
    });

    root.querySelectorAll("script").forEach((sourceScript) => {
      const script = document.createElement("script");
      [...sourceScript.attributes].forEach((attribute) => {
        script.setAttribute(attribute.name, attribute.value);
      });
      if (script.src && !script.hasAttribute("async") && !script.hasAttribute("defer") && script.type !== "module") {
        script.async = false;
      }
      script.textContent = sourceScript.textContent;
      sourceScript.replaceWith(script);
    });
    if (queueArticleImages) return installQueuedArticleImages(root, baseUrl);
    return undefined;
  }, [baseUrl, html, queueArticleImages]);

  return (
    <div
      ref={rootRef}
      className={className}
      data-trusted-arca-html="true"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
});

function ArticleInlineContent({ content }) {
  const fallbackText = typeof content === "string" ? content : String(content?.text || "");
  const segments = Array.isArray(content?.segments) && content.segments.length
    ? content.segments
    : [{ text: fallbackText }];
  return segments.map((segment, index) => {
    let rendered = segment.text;
    if (segment.code) rendered = <code>{rendered}</code>;
    if (segment.bold) rendered = <strong>{rendered}</strong>;
    if (segment.italic) rendered = <em>{rendered}</em>;
    if (segment.underline) rendered = <u>{rendered}</u>;
    if (segment.strike) rendered = <del>{rendered}</del>;
    if (segment.href) {
      rendered = (
        <a href={segment.href} target="_blank" rel="noreferrer">
          {rendered}
        </a>
      );
    }
    return <React.Fragment key={`${index}-${segment.text}`}>{rendered}</React.Fragment>;
  });
}

function ArticleReaderList({ block }) {
  const items = Array.isArray(block?.items) ? block.items : [];
  const listItems = items.map((item, index) => (
    <li key={`${index}-${item?.text || item}`}>
      <ArticleInlineContent content={item} />
    </li>
  ));
  return block?.ordered
    ? <ol className="board-reader-list is-ordered">{listItems}</ol>
    : <ul className="board-reader-list">{listItems}</ul>;
}

function ArticleReaderTableCell({ cell, header = false, scope }) {
  const props = {
    ...(scope ? { scope } : {}),
    ...(Number(cell?.colSpan) > 1 ? { colSpan: cell.colSpan } : {}),
    ...(Number(cell?.rowSpan) > 1 ? { rowSpan: cell.rowSpan } : {}),
  };
  return header
    ? <th {...props}><ArticleInlineContent content={cell} /></th>
    : <td {...props}><ArticleInlineContent content={cell} /></td>;
}

function ArticleReaderTable({ block }) {
  const headers = Array.isArray(block?.headers) ? block.headers : [];
  const rows = Array.isArray(block?.rows) ? block.rows : [];
  return (
    <div className="board-reader-table-scroll" role="region" aria-label="게시글 표" tabIndex={0}>
      <table className="board-reader-table">
        {headers.length ? (
          <thead>
            <tr>
              {headers.map((cell, index) => (
                <ArticleReaderTableCell
                  cell={cell}
                  header
                  scope="col"
                  key={`${index}-${cell?.text || cell}`}
                />
              ))}
            </tr>
          </thead>
        ) : null}
        {rows.length ? (
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                  <ArticleReaderTableCell
                    cell={cell}
                    header={Boolean(cell?.header)}
                    scope={cell?.header ? "row" : undefined}
                    key={`${cellIndex}-${cell?.text || cell}`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

const ARTICLE_READER_IMAGE_TIMEOUT_MS = 45000;

function ArticleReaderImage({ src, sourceSrc = "", alt = "게시글 이미지", imageIndex, onSettled }) {
  const [status, setStatus] = React.useState("loading");
  const settledRef = React.useRef(false);
  const timeoutRef = React.useRef(null);

  const settle = React.useCallback((nextStatus) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    setStatus(nextStatus);
    onSettled?.(imageIndex);
  }, [imageIndex, onSettled]);

  React.useEffect(() => {
    settledRef.current = false;
    setStatus("loading");
    timeoutRef.current = window.setTimeout(() => settle("error"), ARTICLE_READER_IMAGE_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [settle, src]);

  return (
    <figure className={`board-reader-figure is-${status}`}>
      {status === "loading" ? (
        <div className="board-reader-image-status" role="status">
          <LoaderCircle size={20} strokeWidth={2.1} className="is-spinning" aria-hidden="true" />
          <span>이미지를 불러오는 중입니다</span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="board-reader-image-status is-error" role="alert">
          <span>이미지를 불러오지 못했습니다.</span>
          {sourceSrc ? (
            <a href={sourceSrc} target="_blank" rel="noreferrer">원본 이미지 열기</a>
          ) : null}
        </div>
      ) : null}
      <img
        src={src}
        alt={alt}
        decoding="async"
        onLoad={() => settle("loaded")}
        onError={() => settle("error")}
      />
    </figure>
  );
}

function QueuedArticleReaderImage({ shouldLoad, imageIndex, onSettled, ...imageProps }) {
  if (!shouldLoad) {
    return (
      <figure className="board-reader-figure is-waiting" aria-label="게시글 이미지 로딩 대기">
        <div className="board-reader-image-status">
          <span>앞 이미지 로딩 후 불러옵니다</span>
        </div>
      </figure>
    );
  }
  return <ArticleReaderImage {...imageProps} imageIndex={imageIndex} onSettled={onSettled} />;
}

function formatCommentTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function CommentEmoticon({ media, className = "" }) {
  const videoRef = React.useRef(null);

  const playVideo = React.useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.defaultMuted = true;
    video.muted = true;
    const playback = video.play();
    if (playback?.catch) playback.catch(() => {});
  }, []);

  React.useEffect(() => {
    if (media?.type !== "video" || !media?.src) return undefined;
    playVideo();
    const video = videoRef.current;
    video?.addEventListener("canplay", playVideo);
    return () => video?.removeEventListener("canplay", playVideo);
  }, [media?.src, media?.type, playVideo]);

  if (!media?.src) return null;
  if (media.type === "video") {
    return (
      <video
        ref={videoRef}
        className={className}
        src={media.src}
        poster={media.poster || undefined}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="아카콘"
        onPointerEnter={playVideo}
        onFocus={playVideo}
      />
    );
  }
  return <img className={className} src={media.src} alt="아카콘" loading="lazy" decoding="async" />;
}

function ArcaconPackageThumbnail({ src }) {
  const [failedSrc, setFailedSrc] = React.useState("");
  const showImage = Boolean(src) && failedSrc !== src;
  return showImage ? (
    <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
  ) : (
    <Smile size={22} strokeWidth={1.8} aria-hidden="true" />
  );
}

function ArcaEmoticonPicker({ open, onClose, onSelect, onSubmitCombo, submitting }) {
  const [packages, setPackages] = React.useState([]);
  const [items, setItems] = React.useState([]);
  const [activePackageId, setActivePackageId] = React.useState(null);
  const [mode, setMode] = React.useState("single");
  const [comboItems, setComboItems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadPackage = React.useCallback(async (packageId) => {
    setActivePackageId(packageId);
    setItems([]);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/arca/emoticons?packageId=${encodeURIComponent(packageId)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.issues?.[0]?.message || payload.error || `HTTP ${response.status}`);
      }
      setItems(payload.items || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open || packages.length) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    fetch("/api/arca/emoticons", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.issues?.[0]?.message || payload.error || `HTTP ${response.status}`);
        }
        if (cancelled) return;
        const nextPackages = payload.packages || [];
        setPackages(nextPackages);
        if (nextPackages.length) void loadPackage(nextPackages[0].id);
        else setBusy(false);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError.message);
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPackage, open, packages.length]);

  React.useEffect(() => {
    if (open) return;
    setMode("single");
    setComboItems([]);
  }, [open]);

  function selectItem(item) {
    const selection = { ...item, packageId: activePackageId };
    if (mode === "single") {
      onSelect(selection);
      return;
    }
    setComboItems((current) => current.length >= MAX_COMBOCON_ITEMS ? current : [...current, selection]);
  }

  if (!open) return null;
  const activePackage = packages.find((item) => item.id === activePackageId);
  return (
    <div className="board-arcacon-picker" role="dialog" aria-label="보유한 아카콘 선택">
      <div className="board-arcacon-head">
        <div>
          <strong>아카콘</strong>
          <span>{activePackage?.title || "보유 목록"}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="아카콘 선택 닫기">
          <X size={17} strokeWidth={2.2} />
        </button>
      </div>
      <div className="board-arcacon-mode" role="tablist" aria-label="아카콘 등록 모드">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "single"}
          className={mode === "single" ? "is-active" : ""}
          onClick={() => setMode("single")}
        >
          아카콘
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "combo"}
          className={mode === "combo" ? "is-active" : ""}
          onClick={() => setMode("combo")}
        >
          콤보콘
        </button>
      </div>
      <div className="board-arcacon-layout">
        <div className="board-arcacon-packages" role="tablist" aria-label="아카콘 패키지">
          {packages.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={item.id === activePackageId}
              className={item.id === activePackageId ? "is-active" : ""}
              onClick={() => void loadPackage(item.id)}
              title={`${item.title} · ${item.count}개`}
              aria-label={`${item.title}, ${item.count}개`}
              key={item.id}
            >
              <ArcaconPackageThumbnail src={item.thumbnail} />
              <small>{item.count}</small>
            </button>
          ))}
        </div>
        <div className="board-arcacon-content">
          {mode === "single" ? (
            <p className="board-arcacon-hint">아카콘을 선택하면 즉시 등록됩니다.</p>
          ) : (
            <div className="board-combocon-bar">
              <div className="board-combocon-selection" aria-label={`선택한 콤보콘 ${comboItems.length}개`}>
                {comboItems.map((item, index) => (
                  <button
                    type="button"
                    onClick={() => setComboItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label={`${index + 1}번째 아카콘 제거`}
                    title="선택에서 제거"
                    key={`${item.packageId}-${item.id}-${index}`}
                  >
                    <CommentEmoticon media={item} />
                    <span>{index + 1}</span>
                  </button>
                ))}
                {Array.from({ length: MAX_COMBOCON_ITEMS - comboItems.length }, (_, index) => (
                  <span className="is-empty" aria-hidden="true" key={`empty-${index}`}>{comboItems.length + index + 1}</span>
                ))}
              </div>
              <div className="board-combocon-actions">
                <span>최대 3개 · 선택한 순서대로 등록</span>
                <button
                  type="button"
                  onClick={() => void onSubmitCombo(comboItems)}
                  disabled={submitting || !comboItems.length}
                >
                  {submitting ? <LoaderCircle size={15} strokeWidth={2.2} className="is-spinning" /> : <Send size={14} strokeWidth={2.2} />}
                  <span>{submitting ? "등록 중" : `콤보콘 등록 (${comboItems.length})`}</span>
                </button>
              </div>
            </div>
          )}
          {busy ? (
            <div className="board-arcacon-state" role="status">
              <LoaderCircle size={19} strokeWidth={2.1} className="is-spinning" />
              <span>아카콘을 불러오는 중입니다</span>
            </div>
          ) : error ? (
            <div className="board-arcacon-state is-error" role="alert">
              <span>{error}</span>
              {activePackageId != null ? (
                <button type="button" onClick={() => void loadPackage(activePackageId)}>다시 시도</button>
              ) : null}
            </div>
          ) : (
            <div className="board-arcacon-grid">
              {items.map((item) => (
                <button
                  type="button"
                  onClick={() => selectItem(item)}
                  aria-label={mode === "single" ? "이 아카콘 즉시 등록" : "콤보콘에 이 아카콘 추가"}
                  disabled={submitting || (mode === "combo" && comboItems.length >= MAX_COMBOCON_ITEMS)}
                  key={`${activePackageId}-${item.id}`}
                >
                  <CommentEmoticon media={item} />
                  {item.type === "video" ? <span className="board-arcacon-motion">GIF</span> : null}
                </button>
              ))}
              {!items.length ? <p>보유한 아카콘이 없습니다.</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentComposer({ articleUrl, commenting, parentComment = null, onCancel, onSubmitted }) {
  const [content, setContent] = React.useState("");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const postingRef = React.useRef(false);
  const canComment = Boolean(commenting?.canComment && commenting?.signedIn);
  const maxLength = commenting?.maxLength || 8000;

  async function submitCommentPayload(payload) {
    if (!canComment || postingRef.current) return false;
    postingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/arca/comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          url: articleUrl,
          parentId: parentComment?.id || "",
          ...payload,
        }),
      });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok || !responsePayload.ok) {
        throw new Error(responsePayload.issues?.[0]?.message || responsePayload.error || `HTTP ${response.status}`);
      }
      setContent("");
      setPickerOpen(false);
      onSubmitted(responsePayload);
      onCancel?.();
      return true;
    } catch (submitError) {
      setError(submitError.message);
      return false;
    } finally {
      postingRef.current = false;
      setBusy(false);
    }
  }

  function submitText(event) {
    event?.preventDefault();
    const text = content.trim();
    if (!text) return;
    void submitCommentPayload({ contentType: "text", content: text });
  }

  function submitEmoticons(emoticons, options) {
    const payload = createArcaEmoticonCommentPayload(emoticons, options);
    return payload ? submitCommentPayload(payload) : Promise.resolve(false);
  }

  function handleCommentKeyDown(event) {
    if (!shouldSubmitCommentFromKeyEvent(event)) return;
    event.preventDefault();
    submitText();
  }

  if (!canComment) {
    return (
      <div className="board-comment-auth-note">
        {commenting?.signedIn
          ? "현재 계정이나 게시글에서는 댓글을 작성할 수 없습니다."
          : "댓글을 작성하려면 설정에서 아카라이브 로그인을 연결해 주세요."}
      </div>
    );
  }

  return (
    <form className={parentComment ? "board-comment-composer is-reply" : "board-comment-composer"} onSubmit={submitText}>
      <div className="board-comment-composer-head">
        <strong>{parentComment ? `${displayBoardAuthor(parentComment.author)}님에게 답글` : commenting.currentUser || "댓글 쓰기"}</strong>
        {parentComment && onCancel ? (
          <button type="button" onClick={onCancel}>취소</button>
        ) : null}
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={handleCommentKeyDown}
        maxLength={maxLength}
        rows={parentComment ? 3 : 4}
        placeholder={parentComment ? "답글을 입력하세요 · Enter 등록 · Shift+Enter 줄바꿈" : "댓글을 입력하세요 · Enter 등록 · Shift+Enter 줄바꿈"}
        disabled={busy}
        aria-label={parentComment ? "답글 내용" : "댓글 내용"}
      />
      {error ? <p className="board-comment-submit-error" role="alert">{error}</p> : null}
      <div className="board-comment-composer-actions">
        <button
          className={pickerOpen ? "board-comment-arcacon-button is-active" : "board-comment-arcacon-button"}
          type="button"
          onClick={() => setPickerOpen((value) => !value)}
          disabled={busy}
        >
          <Smile size={16} strokeWidth={2.1} />
          <span>아카콘</span>
        </button>
        <span>{`${content.length.toLocaleString("ko-KR")} / ${maxLength.toLocaleString("ko-KR")}`}</span>
        <button className="board-comment-submit" type="submit" disabled={busy || !content.trim()}>
          {busy ? <LoaderCircle size={16} strokeWidth={2.2} className="is-spinning" /> : <Send size={16} strokeWidth={2.2} />}
          <span>{busy ? "게시 중" : parentComment ? "답글 작성" : "작성"}</span>
        </button>
      </div>
      <ArcaEmoticonPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => {
          setContent("");
          void submitEmoticons([item]);
        }}
        onSubmitCombo={(items) => submitEmoticons(items, { combo: true })}
        submitting={busy}
      />
    </form>
  );
}

function StockArticleComments({ article }) {
  const [comments, setComments] = React.useState(article?.comments || []);
  const [commenting, setCommenting] = React.useState(article?.commenting || {});
  const [replyToId, setReplyToId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const articleUrl = article?.url || article?.href || "";

  React.useEffect(() => {
    setComments(article?.comments || []);
    setCommenting(article?.commenting || {});
    setReplyToId("");
    setError("");
    setNotice("");
  }, [article?.comments, article?.commenting, articleUrl]);

  const applyCommentPayload = React.useCallback((payload) => {
    setComments(payload.comments || []);
    if (payload.commenting) setCommenting(payload.commenting);
    setReplyToId("");
    setNotice(payload.verified === false ? "게시 요청은 완료됐지만 새 댓글 확인이 지연되고 있습니다." : "댓글 게시와 재조회 확인을 마쳤습니다.");
  }, []);

  async function refreshComments() {
    if (!articleUrl || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/arca/comments?url=${encodeURIComponent(articleUrl)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.issues?.[0]?.message || payload.error || `HTTP ${response.status}`);
      }
      setComments(payload.comments || []);
      setCommenting(payload.commenting || {});
      setNotice("최신 댓글을 불러왔습니다.");
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="board-comments" aria-labelledby="board-comments-title">
      <header className="board-comments-head">
        <div>
          <h2 id="board-comments-title">댓글 <span>{comments.length.toLocaleString("ko-KR")}</span></h2>
          <p>음성댓글을 제외한 댓글·답글과 아카콘을 표시합니다.</p>
        </div>
        <button type="button" onClick={() => void refreshComments()} disabled={busy}>
          <RefreshCw size={16} strokeWidth={2.2} className={busy ? "is-spinning" : ""} />
          <span>{busy ? "새로고침 중" : "새로고침"}</span>
        </button>
      </header>
      {error ? <div className="board-comments-message is-error" role="alert">{error}</div> : null}
      {notice ? <div className="board-comments-message" role="status">{notice}</div> : null}
      <div className="board-comment-list">
        {comments.map((comment) => (
          <React.Fragment key={comment.id}>
            <article
              className={comment.parentId ? "board-comment is-reply" : "board-comment"}
              style={{ "--comment-depth": Math.min(comment.depth || 0, 4) }}
              id={`reader-comment-${comment.id}`}
            >
              <CommentAvatar src={comment.avatar} />
              <div className="board-comment-main">
                <div className="board-comment-info">
                  <strong>{displayBoardAuthor(comment.author) || "작성자 미상"}</strong>
                  {comment.articleAuthor ? <span className="is-author">글쓴이</span> : null}
                  {comment.authorManager ? <span className="is-manager">관리자</span> : null}
                  <time dateTime={comment.timeIso}>{formatCommentTime(comment.timeIso)}</time>
                </div>
                {comment.html ? (
                  <TrustedArcaHtml
                    html={comment.html}
                    baseUrl={articleUrl}
                    className="board-comment-trusted-html"
                    queueArticleImages
                  />
                ) : comment.text ? <p>{comment.text}</p> : null}
                {!comment.hasLinkCard && comment.links?.length ? (
                  <div className="board-comment-link-fallbacks" aria-label="댓글 원본 링크">
                    {comment.links.map((link) => (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        key={link.href}
                      >
                        <span>{link.label || link.href}</span>
                        <ExternalLink size={13} strokeWidth={2.1} aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                ) : null}
                {!comment.html && comment.emoticons?.length ? (
                  <div className="board-comment-emoticons">
                    {comment.emoticons.map((media, index) => (
                      <CommentEmoticon media={media} key={`${comment.id}-${media.attachmentId || index}`} />
                    ))}
                  </div>
                ) : null}
                {!comment.html && !comment.text && !comment.emoticons?.length ? <p className="is-empty">삭제되었거나 표시할 수 없는 댓글입니다.</p> : null}
                <button
                  className="board-comment-reply-button"
                  type="button"
                  onClick={() => setReplyToId((current) => current === comment.id ? "" : comment.id)}
                  disabled={!commenting?.canComment || !commenting?.signedIn}
                >
                  <Reply size={14} strokeWidth={2.2} />
                  <span>답글</span>
                </button>
              </div>
            </article>
            {replyToId === comment.id ? (
              <div className="board-comment-inline-reply" style={{ "--comment-depth": Math.min((comment.depth || 0) + 1, 4) }}>
                <CommentComposer
                  articleUrl={articleUrl}
                  commenting={commenting}
                  parentComment={comment}
                  onCancel={() => setReplyToId("")}
                  onSubmitted={applyCommentPayload}
                />
              </div>
            ) : null}
          </React.Fragment>
        ))}
        {!comments.length ? <p className="board-comments-empty">아직 댓글이 없습니다.</p> : null}
      </div>
      <CommentComposer articleUrl={articleUrl} commenting={commenting} onSubmitted={applyCommentPayload} />
    </section>
  );
}

function StockArticleReader({ article, busy, error, onClose, onRetry }) {
  const blocks = articleReaderBlocks(article);
  const trustedHtml = String(article?.contentHtml || "").trim();
  const blockImageUrls = new Set(blocks.filter((block) => block?.type === "image").map((block) => block.src));
  const fallbackImages = (article?.readerImageUrls || article?.imageUrls || []).filter(
    (src) => src && !blockImageUrls.has(src)
  );
  const publishedAt = formatArticleReaderTime(article);
  const originalUrl = article?.url || article?.href || "";
  const [nextImageIndex, setNextImageIndex] = React.useState(0);
  let imageSequence = 0;

  React.useEffect(() => {
    setNextImageIndex(0);
  }, [article?.href, article?.url]);

  const advanceImageQueue = React.useCallback((imageIndex) => {
    setNextImageIndex((current) => (current <= imageIndex ? imageIndex + 1 : current));
  }, []);

  React.useEffect(() => {
    function handleReaderKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleReaderKeyDown);
    return () => window.removeEventListener("keydown", handleReaderKeyDown);
  }, [onClose]);

  return (
    <div className="board-reader-shell">
      <div className="board-reader-actions" aria-label="글 읽기 동작">
        <button className="board-reader-back" type="button" onClick={onClose}>
          <ArrowLeft size={17} strokeWidth={2.2} aria-hidden="true" />
          <span>목록으로</span>
        </button>
        {originalUrl ? (
          <a className="board-reader-original" href={originalUrl} target="_blank" rel="noreferrer">
            <span>원문 열기</span>
            <ExternalLink size={15} strokeWidth={2.1} aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <article className="board-reader-article" aria-labelledby="board-reader-title">
        {article?.categoryLabel ? <span className="board-reader-category">{article.categoryLabel}</span> : null}
        <h1 id="board-reader-title">{article?.title || "주식채널 글"}</h1>
        <div className="board-reader-meta" aria-label="게시글 정보">
          <strong>{displayBoardAuthor(article?.author) || "작성자 미상"}</strong>
          {publishedAt ? <span>{publishedAt}</span> : null}
          {article?.view != null ? <span>조회 {formatCount(article.view)}</span> : null}
          {article?.rate != null ? <span>추천 {formatCount(article.rate)}</span> : null}
          {article?.commentCount != null ? <span>댓글 {formatCount(article.commentCount)}</span> : null}
        </div>

        {busy ? (
          <div className="board-reader-loading" role="status">
            <LoaderCircle size={22} strokeWidth={2.1} className="is-spinning" aria-hidden="true" />
            <span>본문을 불러오는 중입니다</span>
          </div>
        ) : error ? (
          <div className="board-reader-error" role="alert">
            <strong>본문을 불러오지 못했습니다.</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetry}>다시 시도</button>
          </div>
        ) : (
          <>
            <div className="board-reader-body">
              {trustedHtml ? (
                <TrustedArcaHtml
                  html={trustedHtml}
                  baseUrl={originalUrl}
                  className="board-reader-trusted-html"
                  queueArticleImages
                />
              ) : blocks.map((block, index) => {
              const key = `${block.type || "paragraph"}-${index}`;
              if (block.type === "image") {
                const imageIndex = imageSequence;
                imageSequence += 1;
                return (
                  <QueuedArticleReaderImage
                    src={block.src}
                    sourceSrc={block.sourceSrc}
                    alt={block.alt || "게시글 이미지"}
                    imageIndex={imageIndex}
                    shouldLoad={imageIndex <= nextImageIndex}
                    onSettled={advanceImageQueue}
                    key={key}
                  />
                );
              }
              if (block.type === "list") return <ArticleReaderList block={block} key={key} />;
              if (block.type === "table") return <ArticleReaderTable block={block} key={key} />;
              if (block.type === "spacer") {
                return <p className="board-reader-spacer" aria-hidden="true" key={key}>{"\u00a0"}</p>;
              }
              if (block.type === "quote") {
                return <blockquote key={key}><ArticleInlineContent content={block} /></blockquote>;
              }
              if (block.type === "pre") return <pre key={key}>{block.text}</pre>;
              if (block.type === "heading") {
                return <h2 key={key}><ArticleInlineContent content={block} /></h2>;
              }
              return <p key={key}><ArticleInlineContent content={block} /></p>;
              })}
              {!trustedHtml && fallbackImages.map((src, index) => {
              const imageIndex = imageSequence;
              imageSequence += 1;
              return (
                <QueuedArticleReaderImage
                  src={src}
                  alt="게시글 이미지"
                  imageIndex={imageIndex}
                  shouldLoad={imageIndex <= nextImageIndex}
                  onSettled={advanceImageQueue}
                  key={`fallback-image-${index}`}
                />
              );
              })}
              {!trustedHtml && !blocks.length && !fallbackImages.length ? (
                <p className="board-reader-empty">표시할 본문이 없습니다. 원문 열기로 게시글을 확인해 주세요.</p>
              ) : null}
            </div>
            <StockArticleComments article={article} />
          </>
        )}
      </article>
    </div>
  );
}

function BoardCategoryRail({ categories, activeCategory, onSelect }) {
  const safeCategories = categories?.length ? categories : [{ name: "", label: "전체" }];
  return (
    <div className="board-category-shell" aria-label="게시판 카테고리">
      <div className="board-category-rail">
        {safeCategories.map((category) => (
          <button
            type="button"
            className={category.name === activeCategory ? "board-category-tab is-active" : "board-category-tab"}
            key={`${category.name || "all"}-${category.label}`}
            onClick={() => onSelect(category.name)}
          >
            {category.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AuthorName({ row }) {
  const author = displayBoardAuthor(row.author);
  return (
    <span className="board-author" title={author}>
      <span>{author || "-"}</span>
      {row.authorFixed || row.authorManager ? <CheckCircle2 size={14} strokeWidth={2.2} /> : null}
      {row.accountUser && !row.authorFixed && !row.authorManager ? <User size={14} strokeWidth={2.2} /> : null}
    </span>
  );
}

function BoardTitleCell({ row, onAttachArticle, onOpenArticle, isAttaching, agentIcon }) {
  return (
    <span className="board-title-cell">
      {row.type === "article" && !row.categoryLabel ? (
        <span className="board-comment-icon" aria-hidden="true">
          <MessageSquare size={16} strokeWidth={2.4} />
        </span>
      ) : null}
      {row.categoryLabel && row.type === "article" ? (
        <span className="board-row-category">{row.categoryLabel}</span>
      ) : null}
      <a
        href={row.href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          if (row.type !== "article" || shouldOpenArticleExternally(event)) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenArticle(row);
        }}
      >
        {row.title}
      </a>
      {row.commentCount ? <span className="board-comment-count">[{row.commentCount}]</span> : null}
      {row.type === "article" ? (
        <button
          className={isAttaching ? "board-codex-context-button is-loading" : "board-codex-context-button"}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAttachArticle(row);
          }}
          disabled={isAttaching}
          aria-label={`${row.title} 글을 에이전트 컨텍스트로 첨부`}
          title="에이전트 컨텍스트로 첨부"
        >
          {isAttaching ? <LoaderCircle size={15} strokeWidth={2.2} /> : <img className="agent-logo-image" src={agentIcon} alt="" />}
        </button>
      ) : null}
    </span>
  );
}

function openBoardRow(row, event, onOpenArticle) {
  if (!row?.href || event.defaultPrevented || event.button > 0) return;
  if (event.target.closest("a, button, input, select, textarea")) return;
  if (row.type === "article") {
    onOpenArticle(row);
    return;
  }
  window.open(row.href, "_blank", "noopener,noreferrer");
}

function handleBoardRowKeyDown(row, event, onOpenArticle) {
  if (event.defaultPrevented || event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  if (row.type === "article") {
    onOpenArticle(row);
    return;
  }
  window.open(row.href, "_blank", "noopener,noreferrer");
}

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const entryControl = target.closest("input, textarea, select, [contenteditable='true']");
  return Boolean(entryControl);
}

function BoardRow({ row, onAttachArticle, onOpenArticle, attachingArticleHref, agentIcon }) {
  const rowClass =
    row.type === "notice" ? "board-row board-row-notice" : row.type === "ad" ? "board-row board-row-ad" : "board-row";
  return (
    <tr
      className={rowClass}
      onClick={(event) => openBoardRow(row, event, onOpenArticle)}
      onKeyDown={(event) => handleBoardRowKeyDown(row, event, onOpenArticle)}
      role={row.href ? "link" : undefined}
      tabIndex={row.href ? 0 : undefined}
      aria-label={row.href ? `${row.title} 글 열기` : undefined}
    >
      <td className="board-col-id">
        {row.type === "ad" ? "광고" : row.type === "notice" ? "공지" : row.number || row.id}
      </td>
      <td className="board-col-title">
        <BoardTitleCell
          row={row}
          onAttachArticle={onAttachArticle}
          onOpenArticle={onOpenArticle}
          isAttaching={Boolean(attachingArticleHref && attachingArticleHref === row.href)}
          agentIcon={agentIcon}
        />
      </td>
      <td className="board-col-author">
        <AuthorName row={row} />
      </td>
      <td className="board-col-time">{row.timeLabel}</td>
      <td className="board-col-view">{formatCount(row.view)}</td>
      <td className="board-col-rate">{row.rate ?? ""}</td>
    </tr>
  );
}

function BoardTable({ board, showHiddenNotices, onToggleHidden, onAttachArticle, onOpenArticle, attachingArticleHref, agentIcon }) {
  const ads = board?.ads || [];
  const notices = board?.notices || [];
  const hiddenNotices = board?.hiddenNotices || [];
  const articles = board?.articles || [];
  const hasRows = ads.length || notices.length || hiddenNotices.length || articles.length;

  return (
    <div className="board-table-wrap">
      <table className="board-table">
        <thead>
          <tr>
            <th className="board-col-id">번호</th>
            <th className="board-col-title">제목</th>
            <th className="board-col-author">작성자</th>
            <th className="board-col-time">작성일</th>
            <th className="board-col-view">조회수</th>
            <th className="board-col-rate">추천</th>
          </tr>
        </thead>
        <tbody>
          {ads.map((row) => (
            <BoardRow
              row={row}
              key={`${row.type}-${row.href}`}
              onAttachArticle={onAttachArticle}
              onOpenArticle={onOpenArticle}
              attachingArticleHref={attachingArticleHref}
              agentIcon={agentIcon}
            />
          ))}
          {notices.map((row) => (
            <BoardRow
              row={row}
              key={`${row.type}-${row.id || row.href}`}
              onAttachArticle={onAttachArticle}
              onOpenArticle={onOpenArticle}
              attachingArticleHref={attachingArticleHref}
              agentIcon={agentIcon}
            />
          ))}
          {hiddenNotices.length ? (
            <tr className="board-hidden-toggle-row">
              <td colSpan={6}>
                <button type="button" onClick={onToggleHidden}>
                  <span>{showHiddenNotices ? "숨겨진 공지 접기" : `숨겨진 공지 펼치기(${hiddenNotices.length}개)`}</span>
                  <ChevronDown size={17} strokeWidth={2.1} />
                </button>
              </td>
            </tr>
          ) : null}
          {showHiddenNotices
            ? hiddenNotices.map((row) => (
                <BoardRow
                  row={row}
                  key={`${row.type}-hidden-${row.id || row.href}`}
                  onAttachArticle={onAttachArticle}
                  onOpenArticle={onOpenArticle}
                  attachingArticleHref={attachingArticleHref}
                  agentIcon={agentIcon}
                />
              ))
            : null}
          {articles.map((row) => (
            <BoardRow
              row={row}
              key={`${row.type}-${row.id || row.href}`}
              onAttachArticle={onAttachArticle}
              onOpenArticle={onOpenArticle}
              attachingArticleHref={attachingArticleHref}
              agentIcon={agentIcon}
            />
          ))}
          {!hasRows ? (
            <tr className="board-empty-row">
              <td colSpan={6}>표시할 게시글이 없습니다.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function BoardPagination({ pages, onPage }) {
  const safePages = (pages || []).filter((page) => page.label && !page.disabled);
  if (!safePages.length) return null;
  return (
    <div className="board-pagination" aria-label="게시판 페이지">
      {safePages.map((page, index) => {
        const isNext = page.label === ">";
        const isLast = page.label === ">>";
        return (
          <button
            type="button"
            className={page.active ? "is-active" : ""}
            key={`${page.label}-${page.page || index}`}
            onClick={() => page.page && onPage(page.page)}
            disabled={!page.page}
            aria-label={isNext ? "다음 페이지" : isLast ? "마지막 페이지" : `${page.label} 페이지`}
          >
            {isLast ? (
              <ChevronsRight size={20} strokeWidth={2.2} />
            ) : isNext ? (
              <ChevronRight size={20} strokeWidth={2.2} />
            ) : (
              page.label
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function StockChannelView({
  activeArticle,
  activeCategoryLabel,
  agentIcon,
  articleBusy,
  articleError,
  attachingArticleHref,
  board,
  boardBusy,
  boardError,
  boardFilters,
  boardSearchInput,
  cutRateOptions,
  notificationBusy,
  notificationActionBusy,
  notificationActionError,
  notificationHealth,
  notificationStatus,
  onAttachArticle,
  onBoardSearchInputChange,
  onCloseArticle,
  onOpenArticle,
  onMarkAllNotificationsRead,
  onOpenNotificationArticle,
  onRefreshBoard,
  onRefreshNotifications,
  onResetBoard,
  onRetryArticle,
  onSelectCategory,
  onSubmitSearch,
  onToggleHiddenNotices,
  onUpdateFilters,
  searchTargetOptions,
  showHiddenNotices,
  sortOptions,
  canvasRef,
  writeUrl,
  notificationUrl,
}) {
  const [notificationDialogOpen, setNotificationDialogOpen] = React.useState(false);
  const notificationTriggerRef = React.useRef(null);
  const notificationCloseButtonRef = React.useRef(null);

  const closeNotificationDialog = React.useCallback(() => {
    setNotificationDialogOpen(false);
  }, []);

  const openNotificationDialog = React.useCallback(() => {
    setNotificationDialogOpen(true);
    void onRefreshNotifications();
  }, [onRefreshNotifications]);

  const openNotificationItem = React.useCallback(
    (event, item) => {
      if (!item?.isStockChannel || shouldOpenArticleExternally(event)) return;
      event.preventDefault();
      setNotificationDialogOpen(false);
      onOpenNotificationArticle(item);
    },
    [onOpenNotificationArticle]
  );

  React.useEffect(() => {
    if (!notificationDialogOpen) return undefined;
    const trigger = notificationTriggerRef.current;
    const focusTimer = window.requestAnimationFrame(() => notificationCloseButtonRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeNotificationDialog();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [closeNotificationDialog, notificationDialogOpen]);

  React.useEffect(() => {
    function handleShortcut(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTextEntryTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "w" || key === "ㅈ") {
        event.preventDefault();
        if (writeUrl) {
          window.open(writeUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (key === "r" || key === "ㄱ") {
        if (boardBusy) return;
        event.preventDefault();
        onRefreshBoard();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [boardBusy, onRefreshBoard, writeUrl]);

  if (activeArticle) {
    return (
      <section
        className="workspace-canvas board-reader-canvas"
        aria-label="아카라이브 주식채널 글 읽기"
        ref={canvasRef}
      >
        <StockArticleReader
          article={activeArticle}
          busy={articleBusy}
          error={articleError}
          onClose={onCloseArticle}
          onRetry={onRetryArticle}
        />
      </section>
    );
  }

  return (
    <section
      className="workspace-canvas board-index-canvas"
      aria-label="아카라이브 주식채널 인덱스"
      ref={canvasRef}
    >
      <div className="board-index-shell">
        <section className="stock-board" aria-labelledby="stock-board-title">
          <header className="stock-board-header">
            <div>
              <h1 id="stock-board-title">
                <button
                  className="board-title-refresh"
                  type="button"
                  onClick={onResetBoard}
                  disabled={boardBusy}
                  aria-label="아카라이브 주식채널 필터 초기화"
                  title="카테고리와 검색 조건을 초기화하고 전체 목록 보기"
                >
                  아카라이브 주식채널
                </button>
              </h1>
              <p>
                {activeCategoryLabel} · {board?.articles?.length ?? 0}개 글 · {boardBusy ? "불러오는 중" : "수동 조회 완료"}
              </p>
            </div>
            <div className="stock-board-actions">
              <button className="board-refresh-button" type="button" onClick={onRefreshBoard} disabled={boardBusy}>
                <RefreshCw size={16} strokeWidth={2.2} />
                <span>{boardBusy ? "조회 중" : "수동 갱신"}</span>
              </button>
              <a className="board-write-link" href={writeUrl} target="_blank" rel="noreferrer">
                <PencilLine size={16} strokeWidth={2.2} />
                <span>글쓰기</span>
              </a>
              {notificationHealth.showNotificationCount ? (
                <button
                  className={[
                    "board-notification-link",
                    notificationHealth.level === "online" ? "is-online" : "",
                    notificationHealth.level === "error" ? "is-error" : "",
                    notificationBusy ? "is-loading" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={openNotificationDialog}
                  ref={notificationTriggerRef}
                  title={notificationHealth.title}
                  aria-label={notificationHealth.ariaLabel}
                  aria-haspopup="dialog"
                  aria-expanded={notificationDialogOpen}
                >
                  <span>{formatCount(notificationHealth.count) || "0"}</span>
                </button>
              ) : null}
            </div>
          </header>

          <BoardCategoryRail
            categories={board?.categories}
            activeCategory={boardFilters.category}
            onSelect={onSelectCategory}
          />

          <div className="board-meta-line">
            <span>{board?.pageTitle || "주식 채널"}</span>
            <span>page {boardFilters.page}</span>
            {boardError ? <strong>{boardError}</strong> : null}
            {board?.issues?.map((item) => (
              <strong key={item.code}>{item.code}</strong>
            ))}
          </div>

          <BoardTable
            board={board}
            showHiddenNotices={showHiddenNotices}
            onToggleHidden={onToggleHiddenNotices}
            onAttachArticle={onAttachArticle}
            onOpenArticle={onOpenArticle}
            attachingArticleHref={attachingArticleHref}
            agentIcon={agentIcon}
          />

          <div className="board-bottom-controls">
            <div className="board-mode-controls">
              <button
                type="button"
                className={!boardFilters.best ? "is-active" : ""}
                onClick={() => onUpdateFilters({ best: false, page: 1 })}
              >
                <List size={15} strokeWidth={2.2} />
                <span>전체글</span>
              </button>
              <button
                type="button"
                className={boardFilters.best ? "is-hot is-active" : "is-hot"}
                onClick={() => onUpdateFilters({ best: true, page: 1 })}
              >
                <Star size={15} strokeWidth={2.2} />
                <span>개념글</span>
              </button>
              <select
                value={boardFilters.sort}
                onChange={(event) => onUpdateFilters({ sort: event.target.value, page: 1 })}
                aria-label="정렬"
              >
                {sortOptions.map((option) => (
                  <option value={option.id} key={option.id || "default-sort"}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={boardFilters.cutRate}
                onChange={(event) => onUpdateFilters({ cutRate: event.target.value, page: 1 })}
                aria-label="추천컷"
              >
                {cutRateOptions.map((option) => (
                  <option value={option.id} key={option.id || "default-cut"}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <form className="board-search" onSubmit={onSubmitSearch}>
              <select
                value={boardFilters.target}
                onChange={(event) => onUpdateFilters({ target: event.target.value, page: 1 })}
                aria-label="검색 대상"
              >
                {searchTargetOptions.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                value={boardSearchInput}
                onChange={(event) => onBoardSearchInputChange(event.target.value)}
                aria-label="검색어"
              />
              <button type="submit">
                <Search size={15} strokeWidth={2.2} />
                <span>검색</span>
              </button>
            </form>
          </div>

          <BoardPagination
            pages={board?.pagination}
            onPage={(page) => onUpdateFilters({ page })}
          />

          <div className="board-footer-actions">
            <a className="board-write-link" href={writeUrl} target="_blank" rel="noreferrer">
              <PencilLine size={16} strokeWidth={2.2} />
              <span>글쓰기</span>
            </a>
          </div>
        </section>
      </div>
      {notificationDialogOpen ? (
        <ArcaNotificationDialog
          actionBusy={notificationActionBusy}
          actionError={notificationActionError}
          closeButtonRef={notificationCloseButtonRef}
          notificationUrl={notificationUrl}
          onClose={closeNotificationDialog}
          onMarkAllRead={onMarkAllNotificationsRead}
          onOpenItem={openNotificationItem}
          status={{ ...notificationStatus, loading: notificationBusy }}
        />
      ) : null}
    </section>
  );
}
