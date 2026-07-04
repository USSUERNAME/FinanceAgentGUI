import React from "react";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import ChevronsRight from "lucide-react/dist/esm/icons/chevrons-right.js";
import List from "lucide-react/dist/esm/icons/list.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Star from "lucide-react/dist/esm/icons/star.js";
import User from "lucide-react/dist/esm/icons/user.js";
import { formatCount } from "../utils/formatters.js";

function displayBoardAuthor(author) {
  return String(author || "")
    .replace(/#\d+\b/g, "")
    .trim();
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

function BoardTitleCell({ row, onAttachArticle, isAttaching, agentIcon }) {
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
      <a href={row.href} target="_blank" rel="noreferrer">
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

function openBoardRow(row, event) {
  if (!row?.href || event.defaultPrevented || event.button > 0) return;
  if (event.target.closest("a, button, input, select, textarea")) return;
  window.open(row.href, "_blank", "noopener,noreferrer");
}

function handleBoardRowKeyDown(row, event) {
  if (event.defaultPrevented || event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  window.open(row.href, "_blank", "noopener,noreferrer");
}

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const entryControl = target.closest("input, textarea, select, [contenteditable='true']");
  return Boolean(entryControl);
}

function BoardRow({ row, onAttachArticle, attachingArticleHref, agentIcon }) {
  const rowClass =
    row.type === "notice" ? "board-row board-row-notice" : row.type === "ad" ? "board-row board-row-ad" : "board-row";
  return (
    <tr
      className={rowClass}
      onClick={(event) => openBoardRow(row, event)}
      onKeyDown={(event) => handleBoardRowKeyDown(row, event)}
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

function BoardTable({ board, showHiddenNotices, onToggleHidden, onAttachArticle, attachingArticleHref, agentIcon }) {
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
              attachingArticleHref={attachingArticleHref}
              agentIcon={agentIcon}
            />
          ))}
          {notices.map((row) => (
            <BoardRow
              row={row}
              key={`${row.type}-${row.id || row.href}`}
              onAttachArticle={onAttachArticle}
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
  activeCategoryLabel,
  agentIcon,
  attachingArticleHref,
  board,
  boardBusy,
  boardError,
  boardFilters,
  boardSearchInput,
  cutRateOptions,
  notificationBusy,
  notificationHealth,
  onAttachArticle,
  onBoardSearchInputChange,
  onRefreshBoard,
  onSelectCategory,
  onSubmitSearch,
  onToggleHiddenNotices,
  onUpdateFilters,
  searchTargetOptions,
  showHiddenNotices,
  sortOptions,
  writeUrl,
  notificationUrl,
}) {
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

  return (
    <section className="workspace-canvas board-index-canvas" aria-label="아카라이브 주식채널 인덱스">
      <div className="board-index-shell">
        <section className="stock-board" aria-labelledby="stock-board-title">
          <header className="stock-board-header">
            <div>
              <h1 id="stock-board-title">
                <button
                  className="board-title-refresh"
                  type="button"
                  onClick={onRefreshBoard}
                  disabled={boardBusy}
                  aria-label="아카라이브 주식채널 수동 갱신"
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
                <a
                  className={[
                    "board-notification-link",
                    notificationHealth.level === "online" ? "is-online" : "",
                    notificationHealth.level === "error" ? "is-error" : "",
                    notificationBusy ? "is-loading" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  href={notificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={notificationHealth.title}
                  aria-label={notificationHealth.ariaLabel}
                >
                  <span>{formatCount(notificationHealth.count) || "0"}</span>
                </a>
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
    </section>
  );
}
