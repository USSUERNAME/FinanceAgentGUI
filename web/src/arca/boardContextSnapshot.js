const BOARD_CONTEXT_NOTICE_LIMIT = 8;
const BOARD_CONTEXT_ARTICLE_LIMIT = 35;

function boardRowForContext(row, index) {
  return {
    rank: index + 1,
    type: row.type || "article",
    id: row.id || row.number || "",
    title: row.title || "",
    category: row.categoryLabel || "",
    author: row.author || "",
    comments: row.commentCount || 0,
    views: row.view || 0,
    recommendation: row.rate || 0,
    time: row.timeIso || row.timeLabel || "",
    url: row.href || "",
  };
}

export function buildBoardIndexContextSnapshot(board, filters, options = {}) {
  const safeFilters = {
    channel: filters?.channel || "stock",
    category: filters?.category || "",
    page: filters?.page || 1,
    mode: filters?.best ? "best" : "all",
    sort: filters?.sort || "registered",
    cutRate: filters?.cutRate || "",
    searchTarget: filters?.target || "all",
    keyword: filters?.keyword || "",
  };

  if (!board) {
    return {
      available: false,
      screen: "stock",
      reason: "아카라이브 주식채널 목록이 아직 로드되지 않았습니다.",
      filters: safeFilters,
    };
  }

  const visibleNotices = [
    ...(Array.isArray(board.notices) ? board.notices : []),
    ...(options.showHiddenNotices && Array.isArray(board.hiddenNotices) ? board.hiddenNotices : []),
  ];
  const articles = Array.isArray(board.articles) ? board.articles : [];

  return {
    available: true,
    screen: "stock",
    source: "현재 화면에 렌더된 아카라이브 주식채널 인덱스 스냅샷",
    pageTitle: board.pageTitle || "주식 채널",
    endpoint: board.endpoint || "",
    fetchedAt: board.fetchedAt || "",
    uiState: {
      categoryLabel: options.activeCategoryLabel || "",
      loading: Boolean(options.busy),
      error: options.error || "",
      hiddenNoticesExpanded: Boolean(options.showHiddenNotices),
    },
    filters: safeFilters,
    counts: {
      noticesVisible: visibleNotices.length,
      hiddenNoticesTotal: Array.isArray(board.hiddenNotices) ? board.hiddenNotices.length : 0,
      articlesVisible: articles.length,
      adsVisible: Array.isArray(board.ads) ? board.ads.length : 0,
    },
    notices: visibleNotices.slice(0, BOARD_CONTEXT_NOTICE_LIMIT).map(boardRowForContext),
    articles: articles.slice(0, BOARD_CONTEXT_ARTICLE_LIMIT).map(boardRowForContext),
    nextActionHint:
      "사용자의 질문이 특정 제목이나 작성자에 관한 것 같으면 이 목록의 url을 열어 본문 컨텍스트를 확보해야 한다. 글 컨텍스트가 명시 첨부된 경우에는 이 인덱스 스냅샷보다 첨부 본문을 우선한다.",
  };
}
