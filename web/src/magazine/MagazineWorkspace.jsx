import React, { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.js";
import Copy from "lucide-react/dist/esm/icons/copy.js";
import FilePlus2 from "lucide-react/dist/esm/icons/file-plus-2.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import SendHorizontal from "lucide-react/dist/esm/icons/send-horizontal.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import stockChannelMagazineLogo from "../assets/stock-channel-magazine-logo.png";
import { MarkdownText } from "../utils/MarkdownText.jsx";
import { formatDateTime } from "../utils/formatters.js";

import {
  magazineFallbackTopics,
  magazineToneSequence,
  MAGAZINE_ARTICLE_PAGE_SIZE,
  magazineDefaultFollowupOptions,
  magazineHeadlineStory,
  magazineFeatureStories,
  magazineFallbackCoverStories,
  magazineArticleList,
  magazineMockArticleSections,
  normalizeMagazineTopicCatalog,
  magazineArticleTopics,
  magazineArticlePublishedFormatter,
  magazineUpdateScheduleFormatter,
  magazineArticlePublishedTime,
  formatMagazineUpdateScheduleTime,
  magazineLatestUpdateTimestamp,
  magazineNextUpdateLabel,
  magazineSchedulerIsActive,
  magazineArticleCountDecisionLabel,
  MAGAZINE_AGENT_CONTEXT_BODY_LIMIT,
  STOCK_ARTICLE_AGENT_CONTEXT_BODY_LIMIT,
  compactMagazineAgentText,
  stripMagazineArticleHtml,
  magazineArticleWorldMemoryContext,
  buildMagazineArticleAgentContext,
  stockArticleInlineText,
  stockArticleBlockText,
  buildStockArticleAgentContext,
  formatArticleReaderTimeForContext,
  normalizeMagazineReaderArticle,
  magazineClipboardExcludeSelector,
  MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO,
  magazineBlobToDataUrl,
  loadMagazineClipboardImage,
  magazineImageSrcToDataUrl,
  inlineMagazineClipboardImages,
  inlineMagazineClipboardCanvases,
  cleanMagazineClipboardNode,
  isMagazineClipboardNbspSpacer,
  trimMagazineClipboardTrailingWhitespace,
  magazineClipboardBlockLikeSelector,
  magazineClipboardWhitespaceContainerSelector,
  isMagazineClipboardBlockLikeNode,
  shouldRemoveMagazineClipboardWhitespaceTextNode,
  normalizeMagazineClipboardTextWhitespace,
  stripMagazineClipboardInternalMarkers,
  createMagazineClipboardSpacer,
  createMagazineClipboardNbspSpacer,
  createMagazineClipboardHeadingSpacer,
  nextMagazineClipboardElement,
  addMagazineClipboardBlockquoteLeadBreak,
  insertMagazineClipboardBlockquoteBreaks,
  insertMagazineClipboardFigureCreditBreak,
  insertMagazineClipboardBreaks,
  normalizeMagazineClipboardBodyHtml,
  magazineClipboardProviderName,
  MAGAZINE_CLIPBOARD_ATTRIBUTION_URL,
  magazineClipboardAttributionText,
  appendMagazineClipboardAttribution,
  magazinePlainTextFromNode,
  buildMagazineClipboardPayload,
  writeMagazineArticleToClipboard,
  normalizeMagazineCommentReply,
  normalizeMagazineComment,
  normalizeMagazineCommentStore,
  magazineCommentStatusText,
} from "./magazineWorkspaceModel.js";
import "./magazine.css";

export function MagazineTopicRow({ topics, activeTopic = "", onSelectTopic, ariaLabel = "매거진 토픽" }) {
  return (
    <div className="magazine-topic-row" aria-label={ariaLabel}>
      {topics.map((topic) => (
        <button
          className={[
            "magazine-topic-badge",
            `is-${topic.tone}`,
            activeTopic === topic.label ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          key={topic.label}
          aria-pressed={activeTopic === topic.label}
          onClick={(event) => onSelectTopic(event, topic.label)}
        >
          {topic.emoji ? (
            <span className="magazine-topic-emoji" aria-hidden="true">
              {topic.emoji}
            </span>
          ) : null}
          <span>{topic.label}</span>
        </button>
      ))}
    </div>
  );
}


export function MagazinePublishedTime({ article, className = "" }) {
  const publishedTime = magazineArticlePublishedTime(article);
  if (!publishedTime) return null;
  const classes = ["magazine-published-time", className].filter(Boolean).join(" ");
  return (
    <time className={classes} dateTime={publishedTime.dateTime}>
      {publishedTime.label}
    </time>
  );
}


export function MagazineUpdateSchedule({
  status,
  articles,
  isStartingNow = false,
  isGeneratingOne = false,
  onStartNow,
  onGenerateOne,
}) {
  const lastUpdate =
    formatMagazineUpdateScheduleTime(magazineLatestUpdateTimestamp(status, articles)) || "기록 없음";
  const nextUpdate = magazineNextUpdateLabel(status);
  const decisionLabel = magazineArticleCountDecisionLabel(status);
  const schedulerActive = magazineSchedulerIsActive(status);
  const showStartButton =
    Boolean(onStartNow) &&
    !isStartingNow &&
    !schedulerActive &&
    status?.scheduler?.enabled !== false;
  const generateOneDisabled = isGeneratingOne || isStartingNow || schedulerActive;
  return (
    <div className="magazine-update-schedule">
      <div className="magazine-update-primary">
        <p>마지막 업데이트: {lastUpdate} / 다음 업데이트 예정: {nextUpdate}</p>
        {showStartButton || onGenerateOne ? (
          <div className="magazine-update-actions">
            {onGenerateOne ? (
              <button
                className="magazine-update-generate-one"
                type="button"
                onClick={onGenerateOne}
                disabled={generateOneDisabled}
                aria-label={isGeneratingOne ? "기사 1건 작성 중" : "기사 1건 작성"}
                title={isGeneratingOne ? "기사 1건 작성 중" : "기사 1건 작성"}
              >
                {isGeneratingOne ? (
                  <LoaderCircle size={14} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <FilePlus2 size={14} strokeWidth={2.2} aria-hidden="true" />
                )}
                <span>{isGeneratingOne ? "작성 중" : "기사 1건 작성"}</span>
              </button>
            ) : null}
            {showStartButton ? (
              <button
                className="magazine-update-refresh tooltip-button"
                type="button"
                aria-label="지금 매거진 작성 시작"
                title="지금 매거진 작성 시작"
                data-tooltip="지금 작성 시작"
                onClick={onStartNow}
              >
                <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {decisionLabel ? <p>{decisionLabel}</p> : null}
    </div>
  );
}


export function MagazineArticleList({
  articles,
  onOpenArticle,
  emptyText = "아직 이 조건에 맞는 기사가 없습니다.",
  listKey = "articles",
}) {
  const safeArticles = Array.isArray(articles) ? articles : [];
  const sentinelRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(MAGAZINE_ARTICLE_PAGE_SIZE);
  const visibleArticles = safeArticles.slice(0, Math.min(visibleCount, safeArticles.length));
  const hasMore = visibleArticles.length < safeArticles.length;

  useEffect(() => {
    setVisibleCount(MAGAZINE_ARTICLE_PAGE_SIZE);
  }, [listKey]);

  useEffect(() => {
    setVisibleCount((current) => {
      const maxVisible = Math.max(MAGAZINE_ARTICLE_PAGE_SIZE, safeArticles.length);
      return Math.max(MAGAZINE_ARTICLE_PAGE_SIZE, Math.min(current, maxVisible));
    });
  }, [safeArticles.length]);

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const node = sentinelRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) => Math.min(current + MAGAZINE_ARTICLE_PAGE_SIZE, safeArticles.length));
      },
      { root: null, rootMargin: "320px 0px 420px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, safeArticles.length, visibleCount]);

  if (!safeArticles.length) {
    return <p className="magazine-topic-empty">{emptyText}</p>;
  }

  return (
    <div className="magazine-article-list">
      {visibleArticles.map((article) => (
        <article className="magazine-list-item" key={article.id || article.title}>
          <div className="magazine-list-copy">
            <div className="magazine-list-topic-row" aria-label="기사 토픽">
              {magazineArticleTopics(article).map((topic) => (
                <span className="magazine-list-topic" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
            <h3>
              <a
                className="magazine-article-link"
                href="#magazine-reader"
                onClick={(event) => onOpenArticle(event, article)}
              >
                {article.title}
              </a>
            </h3>
            <MagazinePublishedTime article={article} />
            <a
              className="magazine-image-link"
              href="#magazine-reader"
              onClick={(event) => onOpenArticle(event, article)}
              aria-label={`${article.title} 기사 열기`}
            >
              <div className="magazine-featured-image magazine-list-image">
                <img src={article.image} alt={article.imageAlt} />
              </div>
            </a>
            <p>{article.summary}</p>
          </div>
        </article>
      ))}
      {hasMore ? <div className="magazine-list-sentinel" ref={sentinelRef} aria-hidden="true" /> : null}
    </div>
  );
}

const MagazinePortfolioEChart = React.lazy(() =>
  import("../portfolio/PortfolioEChart.jsx").then((module) => ({ default: module.PortfolioEChart }))
);

export default function MagazineWorkspace({
  magazineActiveArticle,
  magazineCanvasRef,
  magazineStatus,
  magazineArticles,
  magazineStartNowBusy,
  magazineGenerateOneBusy,
  startMagazineNow,
  magazineGenerateOneToolVisible,
  generateOneMagazineArticle,
  magazineTopicCatalog,
  magazineActiveTopic,
  openMagazineTopic,
  magazineCoverHeadline,
  openMagazineArticle,
  magazineCoverCards,
  magazineActiveTopicEntry,
  closeMagazineTopic,
  magazineTopicArticles,
  magazineTopicModalRef,
  closeMagazineArticle,
  magazineCopyStatus,
  copyMagazineArticle,
  magazineCopyError,
  openMagazineDeleteDialog,
  magazineDeleting,
  magazineReaderArticleRef,
  selectedMagazinePreferenceIds,
  magazinePreferenceSavingId,
  saveMagazinePreference,
  magazinePreferenceNotice,
  magazinePreferenceNoticeFading,
  magazineComments,
  magazineCommentDraft,
  setMagazineCommentDraft,
  magazineCommentSubmitting,
  magazineCommentError,
  submitMagazineComment,
  magazineDeleteDialogOpen,
  confirmMagazineArticleDelete,
  magazineDeleteError,
  closeMagazineDeleteDialog,
}) {
  return (
        <section
          className={`workspace-canvas magazine-canvas${magazineActiveArticle ? " is-reader-open" : ""}`}
          aria-label="주식채널 매거진+"
          ref={magazineCanvasRef}
        >
          <div className="magazine-empty-page">
            <MagazineUpdateSchedule
              status={magazineStatus}
              articles={magazineArticles}
              isStartingNow={magazineStartNowBusy}
              isGeneratingOne={magazineGenerateOneBusy}
              onStartNow={startMagazineNow}
              onGenerateOne={magazineGenerateOneToolVisible ? generateOneMagazineArticle : null}
            />
            <h1 className="magazine-logo-heading">
              <img
                className="magazine-logo-image"
                src={stockChannelMagazineLogo}
                alt="Stock Channel Magazine+"
              />
            </h1>
            <MagazineTopicRow
              topics={magazineTopicCatalog}
              activeTopic={magazineActiveTopic}
              onSelectTopic={openMagazineTopic}
            />
            <div className="magazine-issue-layout" aria-label="매거진 기사 목업">
              <article className="magazine-headline-story">
                <div className="magazine-headline-copy">
                  <span className="magazine-story-kicker">{magazineCoverHeadline.topic}</span>
                  <h2>
                    <a
                      className="magazine-article-link"
                      href="#magazine-reader"
                      onClick={(event) => openMagazineArticle(event, magazineCoverHeadline)}
                    >
                      {magazineCoverHeadline.title}
                    </a>
                  </h2>
                  <p>{magazineCoverHeadline.deck}</p>
                  <MagazinePublishedTime article={magazineCoverHeadline} />
                </div>
                <a
                  className="magazine-image-link"
                  href="#magazine-reader"
                  onClick={(event) => openMagazineArticle(event, magazineCoverHeadline)}
                  aria-label={`${magazineCoverHeadline.title} 기사 열기`}
                >
                  <div className="magazine-featured-image magazine-headline-image">
                    <img src={magazineCoverHeadline.image} alt={magazineCoverHeadline.imageAlt} />
                  </div>
                </a>
              </article>
              <div className="magazine-card-grid" aria-label="피처드 기사">
                {magazineCoverCards.map((story) => (
                  <article className="magazine-article-card" key={story.id || story.title}>
                    <a
                      className="magazine-image-link"
                      href="#magazine-reader"
                      onClick={(event) => openMagazineArticle(event, story)}
                      aria-label={`${story.title} 기사 열기`}
                    >
                      <div className="magazine-featured-image">
                        <img src={story.image} alt={story.imageAlt} />
                      </div>
                    </a>
                    <div className="magazine-card-copy">
                      <span className="magazine-story-kicker">{story.topic}</span>
                      <h3>
                        <a
                          className="magazine-article-link"
                          href="#magazine-reader"
                          onClick={(event) => openMagazineArticle(event, story)}
                        >
                          {story.title}
                        </a>
                      </h3>
                    </div>
                  </article>
                ))}
              </div>
              <section className="magazine-list-section" aria-labelledby="magazine-article-list-heading">
                <div className="magazine-section-heading">
                  <h2 id="magazine-article-list-heading">최신 기사</h2>
                </div>
                <MagazineArticleList
                  articles={magazineArticles}
                  listKey="latest"
                  onOpenArticle={openMagazineArticle}
                />
              </section>
            </div>
          </div>
          {magazineActiveTopicEntry ? (
            <div
              className="magazine-topic-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="magazine-topic-view-title"
              ref={magazineTopicModalRef}
            >
              <div className="magazine-topic-shell">
                <a className="magazine-topic-return-link" href="#magazine-all" onClick={closeMagazineTopic}>
                  ← 전체 기사 보기로 돌아가기
                </a>
                <header className="magazine-topic-view-header">
                  <h1>
                    <a className="magazine-title-link" href="#magazine-all" onClick={closeMagazineTopic}>
                      주식채널 매거진+
                    </a>
                  </h1>
                  <MagazineTopicRow
                    topics={magazineTopicCatalog}
                    activeTopic={magazineActiveTopic}
                    onSelectTopic={openMagazineTopic}
                    ariaLabel="매거진 토픽 필터"
                  />
                </header>
                <section className="magazine-list-section" aria-labelledby="magazine-topic-view-title">
                  <div className="magazine-section-heading">
                    <h2 id="magazine-topic-view-title">{magazineActiveTopic} 주제의 기사</h2>
                  </div>
                  <MagazineArticleList
                    articles={magazineTopicArticles}
                    listKey={`topic:${magazineActiveTopic}`}
                    onOpenArticle={openMagazineArticle}
                    emptyText={`${magazineActiveTopic} 주제로 분류된 기사가 아직 없습니다.`}
                  />
                </section>
              </div>
            </div>
          ) : null}
          {magazineActiveArticle ? (
            <div className="magazine-reader-modal" role="dialog" aria-modal="true" aria-labelledby="magazine-reader-title">
              <div className="magazine-reader-shell">
                <div className="magazine-reader-actions">
                  <div className="magazine-reader-left-actions">
                    <button className="magazine-reader-close" type="button" onClick={closeMagazineArticle}>
                      기사 닫기
                    </button>
                    <button
                      className={[
                        "magazine-reader-copy",
                        magazineCopyStatus !== "idle" ? `is-${magazineCopyStatus}` : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={copyMagazineArticle}
                      disabled={magazineCopyStatus === "copying"}
                      title={magazineCopyError || undefined}
                    >
                      <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
                      <span>
                        {magazineCopyStatus === "copying"
                          ? "복사 중"
                          : magazineCopyStatus === "copied"
                            ? "복사됨"
                            : magazineCopyStatus === "text"
                              ? "텍스트 복사됨"
                              : magazineCopyStatus === "error"
                                ? "복사 실패"
                                : "복사하기"}
                      </span>
                    </button>
                  </div>
                  <button
                    className="magazine-reader-delete"
                    type="button"
                    onClick={openMagazineDeleteDialog}
                    disabled={!magazineActiveArticle.id || magazineDeleting}
                  >
                    <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>기사 삭제</span>
                  </button>
                </div>
                <article className="magazine-reader-article" ref={magazineReaderArticleRef}>
                  <div className="magazine-reader-topic-row" aria-label="기사 토픽">
                    {magazineActiveArticle.topics.map((topic) => (
                      <span className="magazine-list-topic" key={topic}>
                        {topic}
                      </span>
                    ))}
                  </div>
                  <h1 id="magazine-reader-title">{magazineActiveArticle.title}</h1>
                  <MagazinePublishedTime article={magazineActiveArticle} className="magazine-reader-published-time" />
                  <p className="magazine-reader-summary">{magazineActiveArticle.summary}</p>
                  <figure className="magazine-reader-figure">
                    <div className="magazine-featured-image magazine-reader-image">
                      <img src={magazineActiveArticle.image} alt={magazineActiveArticle.imageAlt} />
                    </div>
                    {magazineActiveArticle.imageCredit ? (
                      <figcaption>{magazineActiveArticle.imageCredit}</figcaption>
                    ) : null}
                  </figure>
                  <div className="magazine-reader-body">
                    {magazineActiveArticle.bodyHtml ? (
                      <div
                        className="magazine-reader-html"
                        dangerouslySetInnerHTML={{ __html: magazineActiveArticle.bodyHtml }}
                      />
                    ) : (
                      magazineMockArticleSections.map((section) => (
                        <section className="magazine-reader-section" key={section.heading}>
                          <h2>{section.heading}</h2>
                          <p>{section.body}</p>
                        </section>
                      ))
                    )}
                    {magazineActiveArticle.chartBlocks.length ? (
                      <div className="magazine-reader-chart-list" aria-label="기사 데이터 차트">
                        {magazineActiveArticle.chartBlocks.map((chart, index) => (
                          <section className="magazine-reader-chart-section" key={chart.id || chart.title || index}>
                            <h2>{chart.title}</h2>
                            {chart.note ? <p>{chart.note}</p> : null}
                            <div className="magazine-reader-chart-frame">
                              <React.Suspense fallback={<div className="magazine-reader-chart-loading">차트 읽는 중</div>}>
                                <MagazinePortfolioEChart
                                  option={chart.option}
                                  className="magazine-reader-echart"
                                  ariaLabel={chart.ariaLabel || `${chart.title} 차트`}
                                />
                              </React.Suspense>
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : null}
                    {magazineActiveArticle.followupOptions.length ? (
                      <section className="magazine-reader-followup" aria-label="앞으로 알고 싶은 기사 방향">
                        <h2>앞으로 이 분야에 대해 더 알고 싶은 것이 있으신가요?</h2>
                        <div className="magazine-reader-followup-options">
                          {magazineActiveArticle.followupOptions.map((option, index) => {
                            const isSelected = selectedMagazinePreferenceIds.includes(option.id);
                            const isSaving = magazinePreferenceSavingId === option.id;
                            const tone = option.tone || magazineToneSequence[index % magazineToneSequence.length];
                            return (
                              <button
                                className={[
                                  "magazine-reader-followup-choice",
                                  `is-${tone}`,
                                  isSelected ? "is-selected" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                type="button"
                                key={option.id}
                                aria-pressed={isSelected}
                                disabled={Boolean(magazinePreferenceSavingId)}
                                onClick={() => saveMagazinePreference(option)}
                              >
                                {isSelected ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
                                <span>{isSaving ? "저장 중" : option.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        {magazinePreferenceNotice ? (
                          <div
                            className={[
                              "magazine-reader-followup-notice",
                              magazinePreferenceNoticeFading ? "is-fading" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            role="status"
                          >
                            {magazinePreferenceNotice}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                    <section className="magazine-reader-comments" aria-label="기사 댓글">
                      <h2>추가로 요청하고 싶은 것이 있거나 궁금하신 점이 있다면 알려주세요</h2>
                      <div className="magazine-reader-comment-list">
                        {magazineComments.length ? (
                          magazineComments.map((comment) => {
                            const replyStatusText = magazineCommentStatusText(comment.reply?.status);
                            return (
                              <article className="magazine-reader-comment" key={comment.id}>
                                <div className="magazine-reader-comment-meta">
                                  <strong>{comment.author || "사용자"}</strong>
                                  <span>{formatDateTime(comment.createdAt)}</span>
                                </div>
                                <p>{comment.text}</p>
                                {comment.reply ? (
                                  <div
                                    className={[
                                      "magazine-reader-comment-reply",
                                      comment.reply.status === "error" ? "is-error" : "",
                                      ["waiting", "generating"].includes(comment.reply.status) ? "is-pending" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                  >
                                    <div className="magazine-reader-comment-meta">
                                      <strong>{comment.reply.author || "매거진 편집자 AI"}</strong>
                                      <span>
                                        {replyStatusText || formatDateTime(comment.reply.createdAt)}
                                      </span>
                                    </div>
                                    {["waiting", "generating"].includes(comment.reply.status) ? (
                                      <div className="magazine-reader-comment-pending">
                                        <LoaderCircle size={16} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
                                        <span>{replyStatusText}</span>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="magazine-reader-comment-markdown">
                                          <MarkdownText text={comment.reply.text} splitSingleLineParagraphs />
                                        </div>
                                        {comment.reply.biasEventIds?.length ? (
                                          <div className="magazine-reader-comment-bias-applied" role="status">
                                            <span className="magazine-reader-comment-bias-icon" aria-hidden="true">
                                              <Check size={13} strokeWidth={2.7} />
                                            </span>
                                            <span>사용자의 편집 방향 수정 요청이 반영되었습니다</span>
                                          </div>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })
                        ) : (
                          <p className="magazine-reader-comments-empty">아직 남겨진 코멘트가 없습니다.</p>
                        )}
                      </div>
                      <form className="magazine-reader-comment-form" onSubmit={submitMagazineComment}>
                        <label className="sr-only" htmlFor="magazine-comment-input">
                          기사 코멘트
                        </label>
                        <textarea
                          id="magazine-comment-input"
                          value={magazineCommentDraft}
                          maxLength={4000}
                          onChange={(event) => setMagazineCommentDraft(event.target.value)}
                          placeholder="궁금한 점이나 앞으로 보고 싶은 기사 방향을 적어주세요."
                          disabled={magazineCommentSubmitting}
                        />
                        <div className="magazine-reader-comment-form-row">
                          {magazineCommentError ? (
                            <span className="magazine-reader-comment-error">{magazineCommentError}</span>
                          ) : (
                            <span>{magazineCommentDraft.length.toLocaleString("ko-KR")} / 4,000</span>
                          )}
                          <button
                            className={[
                              "magazine-reader-comment-submit",
                              magazineCommentSubmitting ? "is-loading" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            type="submit"
                            disabled={!magazineCommentDraft.trim() || magazineCommentSubmitting}
                            aria-label={magazineCommentSubmitting ? "답변 준비 중" : "등록"}
                            title={magazineCommentSubmitting ? "답변 준비 중" : undefined}
                          >
                            {magazineCommentSubmitting ? (
                              <LoaderCircle size={16} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
                            ) : (
                              <>
                                <SendHorizontal size={16} strokeWidth={2.2} aria-hidden="true" />
                                <span>등록</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </section>
                    <button className="magazine-reader-return" type="button" onClick={closeMagazineArticle}>
                      돌아가기
                    </button>
                  </div>
                </article>
              </div>
              {magazineDeleteDialogOpen ? (
                <div className="magazine-reader-delete-overlay">
                  <div
                    className="magazine-reader-delete-dialog"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="magazine-delete-dialog-title"
                    aria-describedby="magazine-delete-dialog-description"
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent?.isComposing || magazineDeleting) return;
                      event.preventDefault();
                      event.stopPropagation();
                      void confirmMagazineArticleDelete();
                    }}
                  >
                    <h2 id="magazine-delete-dialog-title">정말 삭제하시겠습니까?</h2>
                    <p id="magazine-delete-dialog-description">삭제한 기사는 되돌릴 수 없습니다.</p>
                    {magazineDeleteError ? (
                      <p className="magazine-reader-delete-error" role="alert">
                        {magazineDeleteError}
                      </p>
                    ) : null}
                    <div className="magazine-reader-delete-dialog-actions">
                      <button
                        className="magazine-reader-delete-cancel"
                        type="button"
                        onClick={closeMagazineDeleteDialog}
                        disabled={magazineDeleting}
                      >
                        취소
                      </button>
                      <button
                        className="magazine-reader-delete-confirm"
                        type="button"
                        onClick={confirmMagazineArticleDelete}
                        disabled={magazineDeleting}
                        autoFocus
                      >
                        {magazineDeleting ? (
                          <LoaderCircle size={15} strokeWidth={2.2} className="is-spinning" aria-hidden="true" />
                        ) : null}
                        <span>{magazineDeleting ? "삭제 중" : "확인"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
  );
}
