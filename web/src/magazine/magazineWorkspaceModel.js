export const magazineFallbackTopics = [
  { label: "시장", emoji: "📈", tone: "market" },
  { label: "금융", emoji: "🏦", tone: "finance" },
  { label: "경제", emoji: "🌐", tone: "economy" },
  { label: "산업", emoji: "🏭", tone: "industry" },
  { label: "테크", emoji: "💻", tone: "tech" },
  { label: "정치", emoji: "🏛️", tone: "policy" },
  { label: "AI", emoji: "🤖", tone: "ai" },
  { label: "기후", emoji: "🌱", tone: "climate" },
  { label: "크립토", emoji: "🪙", tone: "crypto" },
];
export const magazineToneSequence = ["market", "finance", "economy", "industry", "tech", "policy", "ai", "climate", "crypto"];
export const MAGAZINE_ARTICLE_PAGE_SIZE = 5;
export const magazineDefaultFollowupOptions = [
  {
    id: "deeper-data",
    label: "데이터를 더 자세히",
    prompt: "이 주제의 핵심 데이터를 더 비교하는 후속 기사",
    tone: "market",
  },
  {
    id: "market-impact",
    label: "시장 영향 더 보기",
    prompt: "이 이슈가 자산 가격과 업종에 미치는 영향",
    tone: "finance",
  },
  {
    id: "company-map",
    label: "관련 기업으로 확장",
    prompt: "연결되는 기업, ETF, 산업 밸류체인을 정리하는 기사",
    tone: "industry",
  },
  {
    id: "next-signal",
    label: "다음 신호 추적",
    prompt: "이 이슈를 확인하거나 반박할 다음 지표와 일정",
    tone: "economy",
  },
];
export const magazineHeadlineStory = {
  topic: "커버 스토리",
  title: "금리 이후의 시장, 성장주의 판이 다시 열리나",
  deck:
    "달러 약세, 금리 인하 기대, 실적 시즌의 방향성이 한 화면에 걸린 이번 주 시장의 중심축을 짚습니다. 성장주 반등이 단순한 유동성 랠리인지, 아니면 이익 전망과 투자 심리가 함께 되살아나는 초기 신호인지 구분하는 것이 핵심입니다. 이번 커버스토리는 반도체, AI 인프라, 금융 여건, 경기민감 업종의 움직임을 연결해 다음 시장 국면의 주도권이 어디로 이동하는지 살펴봅니다.",
  image:
    "https://images.unsplash.com/photo-1740199929970-1c884baae7d8?auto=format&fit=crop&w=1200&q=80",
  imageAlt: "도시 금융 지구의 고층 빌딩 전경",
  imageCredit: "사진: Unsplash",
};
export const magazineFeatureStories = [
  {
    topic: "시장",
    title: "리스크 온의 재개, 지수보다 강한 섹터는 어디인가",
    image:
      "https://images.unsplash.com/photo-1742076553114-cfd4f27de46f?auto=format&fit=crop&w=900&q=80",
    imageAlt: "노트북 화면에 표시된 주식 시장 차트",
    imageCredit: "사진: Unsplash",
  },
  {
    topic: "AI",
    title: "데이터센터 전력 수요가 다시 CAPEX를 흔든다",
    image:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=900&q=80",
    imageAlt: "데이터센터 서버 랙",
    imageCredit: "사진: Unsplash",
  },
  {
    topic: "산업",
    title: "항만과 운임이 말하는 공급망의 온도",
    image:
      "https://images.unsplash.com/photo-1769144256207-bc4bb75b29db?auto=format&fit=crop&w=900&q=80",
    imageAlt: "컨테이너를 실은 화물선과 항만",
    imageCredit: "사진: Unsplash",
  },
  {
    topic: "기후",
    title: "재생에너지 투자, 금리 하락 국면의 수혜가 될까",
    image:
      "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=80",
    imageAlt: "넓게 펼쳐진 태양광 패널",
    imageCredit: "사진: Unsplash",
  },
];
export const magazineFallbackCoverStories = [magazineHeadlineStory, ...magazineFeatureStories];
export const magazineArticleList = [
  {
    topics: ["시장", "경제"],
    title: "달러 약세와 실적 기대가 만든 위험자산의 새 균형",
    image:
      "https://images.unsplash.com/photo-1742076553114-cfd4f27de46f?auto=format&fit=crop&w=900&q=80",
    imageAlt: "노트북 화면에 표시된 주식 시장 차트",
    imageCredit: "사진: Unsplash",
    summary:
      "금리 인하 기대가 선반영된 구간에서 환율, 이익 전망, 밸류에이션이 동시에 움직이는 흐름을 정리합니다. 최근 위험자산 반등은 단순한 유동성 기대만으로 설명하기 어렵고, 달러 약세와 기업 실적의 하향 안정이 함께 작동하고 있습니다. 이번 글은 시장이 어떤 조건에서 성장주와 경기민감주를 다시 가격에 반영하는지, 그리고 투자자가 확인해야 할 조기 신호가 무엇인지 분해합니다.",
  },
  {
    topics: ["AI", "테크"],
    title: "AI 인프라 병목은 GPU가 아니라 전력에서 시작된다",
    image:
      "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=900&q=80",
    imageAlt: "데이터센터 서버 랙",
    imageCredit: "사진: Unsplash",
    summary:
      "데이터센터 증설 경쟁이 전력망, 냉각, 부동산, 클라우드 CAPEX로 번지는 경로를 기사 후보로 분해합니다. AI 수요는 여전히 GPU와 모델 경쟁으로 소비되지만, 실제 투자 병목은 전력 인입과 운영 효율에서 먼저 드러나는 중입니다. 이 글은 전력 계약, 서버 밀도, 클라우드 기업의 자본지출 계획을 연결해 AI 인프라 사이클의 다음 수혜 영역을 살펴봅니다.",
  },
  {
    topics: ["산업", "금융"],
    title: "운임 반등이 제조업 마진에 보내는 조기 신호",
    image:
      "https://images.unsplash.com/photo-1769144256207-bc4bb75b29db?auto=format&fit=crop&w=900&q=80",
    imageAlt: "컨테이너를 실은 화물선과 항만",
    imageCredit: "사진: Unsplash",
    summary:
      "항만 체류, 컨테이너 운임, 재고 사이클을 함께 보며 산업재와 소비재의 비용 압력을 추적합니다. 운임 반등이 일시적인 병목인지, 아니면 제조업 주문 회복의 신호인지에 따라 시장 해석은 크게 달라집니다. 이번 글은 물류 비용 변화가 기업 마진, 납기, 재고 보충 전략에 미치는 영향을 정리하고 관련 업종의 민감도를 비교합니다.",
  },
  {
    topics: ["기후", "정치"],
    title: "재생에너지 보조금 논쟁이 다시 투자 사이클을 흔든다",
    image:
      "https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=80",
    imageAlt: "넓게 펼쳐진 태양광 패널",
    imageCredit: "사진: Unsplash",
    summary:
      "정책 불확실성과 금리 변화가 태양광, 배터리, 전력 인프라 기업의 투자 판단에 미치는 영향을 요약합니다. 재생에너지 섹터는 장기 수요가 분명해도 보조금, 인허가, 자금조달 비용에 따라 단기 주가가 크게 흔들립니다. 이 글은 정책 논쟁이 프로젝트 파이프라인과 밸류에이션에 어떤 경로로 반영되는지, 그리고 금리 하락이 실제 주문 회복으로 이어지는 조건을 살핍니다.",
  },
  {
    topics: ["크립토", "금융"],
    title: "ETF 자금 유입 이후 크립토 시장의 두 번째 관문",
    image:
      "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=900&q=80",
    imageAlt: "암호화폐 동전과 전자 회로 이미지",
    imageCredit: "사진: Unsplash",
    summary:
      "기관 자금 유입 이후 유동성, 규제, 스테이블코인 결제망이 다음 가격 발견 구간을 어떻게 만들지 살핍니다. ETF 출시 이후 시장은 단기 수급보다 제도권 금융과 온체인 생태계가 만나는 구조적 변화를 더 크게 반영하고 있습니다. 이 글은 거래소 유동성, 커스터디, 결제 인프라, 규제 리스크를 함께 놓고 크립토 시장의 두 번째 성장 관문을 점검합니다.",
  },
];
export const magazineMockArticleSections = [
  {
    heading: "이슈의 핵심",
    body:
      "이번 목업 기사는 월드 메모리에서 감지한 주요 이슈를 하나의 매거진형 기사로 확장했을 때의 읽기 경험을 확인하기 위한 샘플입니다. 실제 구현에서는 이 위치에 핵심 배경, 시장 맥락, 관련 기업, 확인해야 할 데이터 포인트가 들어가게 됩니다.",
  },
  {
    heading: "시장이 보는 신호",
    body:
      "금리, 환율, 수급, 실적 전망은 서로 따로 움직이는 것처럼 보이지만 기사 작성 단계에서는 하나의 내러티브로 묶여야 합니다. 독자는 이 문단에서 단순한 뉴스 요약이 아니라 왜 지금 이 주제가 중요한지, 어떤 변수가 다음 국면을 바꿀 수 있는지를 빠르게 파악하게 됩니다.",
  },
  {
    heading: "다음 확인 포인트",
    body:
      "후속 기사에서는 관련 기업의 실적 발표, 정책 일정, 원자재 가격, ETF 자금 흐름, 산업별 주문 지표를 함께 비교할 수 있습니다. 이 목업은 그런 리서치 큐가 기사 본문으로 변환됐을 때 화면 안에서 충분히 읽을 만한지 확인하는 용도입니다.",
  },
];

export function normalizeMagazineTopicCatalog(topics) {
  const sourceTopics = Array.isArray(topics) && topics.length ? topics : magazineFallbackTopics;
  const seen = new Set();
  const normalized = sourceTopics
    .map((topic, index) => {
      const label = String(topic?.label || topic || "").trim();
      if (!label || seen.has(label)) return null;
      seen.add(label);
      return {
        label,
        emoji: String(topic?.emoji || "").trim(),
        tone: String(topic?.tone || magazineToneSequence[index % magazineToneSequence.length] || "market").trim(),
      };
    })
    .filter(Boolean);
  return normalized.length ? normalized : magazineFallbackTopics;
}

export function magazineArticleTopics(article) {
  const topics = Array.isArray(article?.topics)
    ? article.topics
    : [article?.topic].filter(Boolean);
  return topics.map((topic) => String(topic || "").trim()).filter(Boolean);
}

export const magazineArticlePublishedFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const magazineUpdateScheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function magazineArticlePublishedTime(article) {
  const rawValue = article?.publishedAt || article?.createdAt || article?.updatedAt || "";
  if (!rawValue) return null;
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return null;
  return {
    dateTime: date.toISOString(),
    label: `송고 ${magazineArticlePublishedFormatter.format(date)}`,
  };
}

export function formatMagazineUpdateScheduleTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    magazineUpdateScheduleFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}시 ${parts.minute}분`;
}

export function magazineLatestUpdateTimestamp(status, articles = []) {
  return (
    status?.latestArticle?.publishedAt ||
    status?.readState?.latestArticleAt ||
    articles?.[0]?.publishedAt ||
    articles?.[0]?.createdAt ||
    articles?.[0]?.updatedAt ||
    ""
  );
}

export function magazineNextUpdateLabel(status) {
  if (status?.scheduler?.running || status?.scheduler?.currentCycle || status?.scheduler?.manualStartPending) {
    return "모델 판단 중";
  }
  if (status?.scheduler?.generationInFlight || status?.scheduler?.generationLock) return "작성 중";
  const nextUpdate = formatMagazineUpdateScheduleTime(
    status?.scheduler?.nextRetryAt || status?.scheduler?.nextRunAt
  );
  if (nextUpdate) return nextUpdate;
  if (status?.scheduler?.enabled === false) return "예정 없음";
  return "대기 중";
}

export function magazineSchedulerIsActive(status) {
  const scheduler = status?.scheduler || {};
  return Boolean(
    scheduler.running ||
      scheduler.currentCycle ||
      scheduler.activeCycle ||
      scheduler.generationInFlight ||
      scheduler.generationLock ||
      scheduler.manualStartPending ||
      scheduler.manualStartRequestedAt
  );
}

export function magazineArticleCountDecisionLabel(status) {
  const scheduler = status?.scheduler || {};
  if (scheduler.manualStartPending || scheduler.manualStartRequestedAt) {
    return "모델 판단 중: 지금 새 기사로 만들 만한 각도가 있는지 확인하고 있습니다.";
  }
  if (scheduler.generationInFlight || scheduler.generationLock) {
    return "작성 작업 실행 중: 기존 작업이 끝난 뒤 다음 모델 판단을 진행합니다.";
  }
  const cycle = scheduler.currentCycle || scheduler.activeCycle || scheduler.lastCycle;
  const decision = cycle?.articleCountDecision;
  if (!decision && cycle?.reason === "generation-lock-active") {
    return "작성 작업 실행 중: 모델 판단은 기존 작업 완료 후 다시 진행됩니다.";
  }
  if (!decision) return "";
  const targetCount = Number.isFinite(Number(decision.targetCount)) ? Number(decision.targetCount) : 0;
  const maxCount = Number.isFinite(Number(decision.maxCount)) ? Number(decision.maxCount) : 3;
  const provider = decision.provider === "antigravity-cli" ? "Antigravity" : decision.provider === "codex-cli" ? "Codex" : "";
  const suffix = decision.fallback ? "fallback" : provider;
  const reason = String(decision.reason || "").trim();
  return [
    `모델 산정: ${targetCount}/${maxCount}`,
    suffix ? ` · ${suffix}` : "",
    reason ? ` · ${reason}` : "",
  ].join("");
}

export const MAGAZINE_AGENT_CONTEXT_BODY_LIMIT = 12000;
export const STOCK_ARTICLE_AGENT_CONTEXT_BODY_LIMIT = 12000;

export function compactMagazineAgentText(value, maxLength = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function stripMagazineArticleHtml(html = "") {
  const source = String(html || "");
  if (!source) return "";
  if (typeof window !== "undefined" && typeof window.DOMParser === "function") {
    const parsed = new window.DOMParser().parseFromString(source, "text/html");
    return compactMagazineAgentText(parsed.body?.textContent || "", MAGAZINE_AGENT_CONTEXT_BODY_LIMIT);
  }
  return compactMagazineAgentText(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h1|h2|h3|li)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'"),
    MAGAZINE_AGENT_CONTEXT_BODY_LIMIT
  );
}

export function magazineArticleWorldMemoryContext(worldMemory) {
  const source = worldMemory && typeof worldMemory === "object" ? worldMemory : null;
  if (!source) return null;
  const vectorSearch = source.vectorSearch && typeof source.vectorSearch === "object" ? source.vectorSearch : {};
  return {
    retrievalPolicy: compactMagazineAgentText(source.retrievalPolicy || "", 120),
    query: compactMagazineAgentText(source.query || "", 260),
    vectorSearch: {
      engine: compactMagazineAgentText(vectorSearch.engine || "", 80),
      model: compactMagazineAgentText(vectorSearch.model || "", 80),
      matchedCount: Number(vectorSearch.matchedCount || 0),
      hits: Array.isArray(vectorSearch.hits)
        ? vectorSearch.hits.slice(0, 8).map((hit) => ({
            eventId: compactMagazineAgentText(hit?.eventId || "", 80),
            title: compactMagazineAgentText(hit?.title || "", 220),
            storyFamily: compactMagazineAgentText(hit?.storyFamily || "", 120),
            createdAt: compactMagazineAgentText(hit?.createdAt || "", 80),
          }))
        : [],
    },
  };
}

export function buildMagazineArticleAgentContext(article) {
  if (!article) return null;
  const publishedTime = magazineArticlePublishedTime(article);
  const bodyText =
    stripMagazineArticleHtml(article.bodyHtml) ||
    magazineMockArticleSections.map((section) => `${section.heading}\n${section.body}`).join("\n\n");
  return {
    source: "magazine-reader",
    id: compactMagazineAgentText(article.id || "", 120),
    articleType: compactMagazineAgentText(article.articleType || "", 80),
    title: compactMagazineAgentText(article.title || "", 240),
    topics: magazineArticleTopics(article).map((topic) => compactMagazineAgentText(topic, 60)).slice(0, 12),
    summary: compactMagazineAgentText(article.summary || "", 1400),
    publishedAt: compactMagazineAgentText(article.publishedAt || article.createdAt || article.updatedAt || "", 120),
    publishedTimeLabel: publishedTime?.label || "",
    image: {
      alt: compactMagazineAgentText(article.imageAlt || "", 180),
      credit: compactMagazineAgentText(article.imageCredit || "", 180),
    },
    sourceBasis: Array.isArray(article.sourceBasis)
      ? article.sourceBasis.map((item) => compactMagazineAgentText(item, 160)).filter(Boolean).slice(0, 8)
      : [],
    bodyText,
    bodyTruncated: bodyText.length >= MAGAZINE_AGENT_CONTEXT_BODY_LIMIT,
    chartBlocks: Array.isArray(article.chartBlocks)
      ? article.chartBlocks.slice(0, 8).map((chart) => ({
          id: compactMagazineAgentText(chart?.id || "", 80),
          title: compactMagazineAgentText(chart?.title || "", 180),
          note: compactMagazineAgentText(chart?.note || "", 360),
          ariaLabel: compactMagazineAgentText(chart?.ariaLabel || "", 180),
        }))
      : [],
    followupOptions: Array.isArray(article.followupOptions)
      ? article.followupOptions.slice(0, 6).map((option) => ({
          id: compactMagazineAgentText(option?.id || "", 80),
          label: compactMagazineAgentText(option?.label || "", 120),
          prompt: compactMagazineAgentText(option?.prompt || "", 260),
          topics: Array.isArray(option?.topics)
            ? option.topics.map((topic) => compactMagazineAgentText(topic, 60)).filter(Boolean).slice(0, 8)
            : [],
        }))
      : [],
    worldMemory: magazineArticleWorldMemoryContext(article.worldMemory),
  };
}

export function stockArticleInlineText(content) {
  if (typeof content === "string") return content.trim();
  return String(content?.text || "").trim();
}

export function stockArticleBlockText(block) {
  if (block?.type === "image") return `[이미지] ${String(block?.alt || "게시글 이미지").trim()}`;
  if (block?.type === "list") {
    return (Array.isArray(block.items) ? block.items : [])
      .map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${stockArticleInlineText(item)}`)
      .join("\n");
  }
  if (block?.type === "table") {
    const rows = [block.headers, ...(Array.isArray(block.rows) ? block.rows : [])].filter(
      (row) => Array.isArray(row) && row.length
    );
    return rows.map((row) => `| ${row.map(stockArticleInlineText).join(" | ")} |`).join("\n");
  }
  return stockArticleInlineText(block);
}

export function buildStockArticleAgentContext(article) {
  if (!article) return null;
  const blockText = Array.isArray(article.contentBlocks)
    ? article.contentBlocks
        .map((block) => {
          const text = stockArticleBlockText(block);
          if (!text) return "";
          return block?.type === "heading" ? `${text}\n` : text;
        })
        .filter(Boolean)
        .join("\n\n")
    : "";
  const rawBodyText = String(blockText || article.contentText || article.description || "")
    .replace(/\s+/g, " ")
    .trim();
  const bodyText = compactMagazineAgentText(rawBodyText, STOCK_ARTICLE_AGENT_CONTEXT_BODY_LIMIT);
  return {
    source: "stock-channel-reader",
    id: compactMagazineAgentText(article.id || article.number || "", 120),
    url: compactMagazineAgentText(article.url || article.href || "", 1000),
    title: compactMagazineAgentText(article.title || "", 260),
    categoryLabel: compactMagazineAgentText(article.categoryLabel || "", 100),
    author: compactMagazineAgentText(article.author || "", 180),
    publishedAt: compactMagazineAgentText(article.timeIso || "", 120),
    publishedTimeLabel: compactMagazineAgentText(formatArticleReaderTimeForContext(article), 120),
    stats: {
      views: Number(article.view || 0),
      recommendations: Number(article.rate || 0),
      comments: Number(article.commentCount || 0),
    },
    bodyText,
    bodyTruncated: rawBodyText.length > bodyText.length,
    images: Array.isArray(article.imageUrls)
      ? article.imageUrls.slice(0, 24).map((src) => compactMagazineAgentText(src, 1000)).filter(Boolean)
      : [],
  };
}

export function formatArticleReaderTimeForContext(article) {
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

export function normalizeMagazineReaderArticle(article) {
  const topics = Array.isArray(article?.topics)
    ? article.topics
    : [article?.topic].filter(Boolean);
  const followupOptions = Array.isArray(article?.followupOptions) && article.followupOptions.length
    ? article.followupOptions
    : magazineDefaultFollowupOptions;
  return {
    id: article?.id || "",
    topics: topics.length ? topics : ["매거진"],
    title: article?.title || "주식채널 매거진 기사",
    summary:
      article?.summary ||
      article?.deck ||
      "월드 메모리의 주요 이슈를 바탕으로 만든 매거진 기사 목업입니다.",
    image: article?.image || magazineHeadlineStory.image,
    imageAlt: article?.imageAlt || magazineHeadlineStory.imageAlt,
    imageCredit: article?.imageCredit || magazineHeadlineStory.imageCredit,
    bodyHtml: article?.bodyHtml || "",
    chartBlocks: Array.isArray(article?.chartBlocks) ? article.chartBlocks : [],
    followupOptions: followupOptions
      .map((option, index) => ({
        id: option?.id || `followup-${index + 1}`,
        label: option?.label || option?.title || `후속 기사 ${index + 1}`,
        prompt: option?.prompt || option?.label || "",
        topics: Array.isArray(option?.topics) && option.topics.length ? option.topics : topics,
        tone: option?.tone || magazineToneSequence[index % magazineToneSequence.length],
      }))
      .slice(0, 6),
    worldMemory: article?.worldMemory || null,
    generationAgent: article?.generationAgent || null,
    articleType: article?.articleType || "",
    publishedAt: article?.publishedAt || "",
    createdAt: article?.createdAt || "",
    updatedAt: article?.updatedAt || "",
    sourceBasis: Array.isArray(article?.sourceBasis) ? article.sourceBasis : [],
  };
}

export const magazineClipboardExcludeSelector = [
  ".magazine-reader-topic-row",
  ".magazine-reader-followup",
  ".magazine-reader-comments",
  ".magazine-reader-return",
].join(", ");

export const MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO = 16 / 9;

export function magazineBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

export function loadMagazineClipboardImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

export async function magazineImageSrcToDataUrl(src, options = {}) {
  const shouldCrop = Boolean(options.cropToReaderFrame);
  if (!src) return src;
  if (src.startsWith("data:") && !shouldCrop) return src;
  const response = await fetch(src, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`이미지를 가져오지 못했습니다. (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("이미지 형식이 아닙니다.");
  const dataUrl = await magazineBlobToDataUrl(blob);
  if (!shouldCrop) return dataUrl;
  const sourceImage = await loadMagazineClipboardImage(dataUrl);
  const naturalWidth = sourceImage.naturalWidth || sourceImage.width;
  const naturalHeight = sourceImage.naturalHeight || sourceImage.height;
  if (!naturalWidth || !naturalHeight) return dataUrl;

  const targetAspectRatio = Number(options.aspectRatio) || MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO;
  const imageAspectRatio = naturalWidth / naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = naturalWidth;
  let sourceHeight = naturalHeight;

  if (imageAspectRatio > targetAspectRatio) {
    sourceWidth = naturalHeight * targetAspectRatio;
    sourceX = (naturalWidth - sourceWidth) / 2;
  } else if (imageAspectRatio < targetAspectRatio) {
    sourceHeight = naturalWidth / targetAspectRatio;
    sourceY = (naturalHeight - sourceHeight) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth);
  canvas.height = Math.round(sourceHeight);
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function inlineMagazineClipboardImages(sourceNode, cloneNode) {
  const sourceImages = Array.from(sourceNode.querySelectorAll("img"));
  const cloneImages = Array.from(cloneNode.querySelectorAll("img"));
  await Promise.all(
    cloneImages.map(async (image, index) => {
      const sourceImage = sourceImages[index];
      const source = sourceImage?.currentSrc || sourceImage?.src || image.currentSrc || image.src || image.getAttribute("src");
      if (!source) return;
      try {
        const shouldCropToReaderFrame = Boolean(sourceImage?.closest(".magazine-featured-image"));
        image.setAttribute("src", await magazineImageSrcToDataUrl(source, {
          cropToReaderFrame: shouldCropToReaderFrame,
          aspectRatio: MAGAZINE_CLIPBOARD_IMAGE_ASPECT_RATIO,
        }));
      } catch (error) {
        image.setAttribute("src", new URL(source, window.location.href).href);
        image.setAttribute("data-copy-image-warning", error.message || "image inline failed");
      }
    })
  );
}

export function inlineMagazineClipboardCanvases(sourceNode, cloneNode) {
  const sourceCanvases = Array.from(sourceNode.querySelectorAll("canvas"));
  const cloneCanvases = Array.from(cloneNode.querySelectorAll("canvas"));
  cloneCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    if (!sourceCanvas) return;
    try {
      const image = document.createElement("img");
      image.src = sourceCanvas.toDataURL("image/png");
      image.alt = canvas.getAttribute("aria-label") || "기사 차트";
      image.width = sourceCanvas.width;
      image.height = sourceCanvas.height;
      canvas.replaceWith(image);
    } catch {
      canvas.remove();
    }
  });
}

export function cleanMagazineClipboardNode(node) {
  node.querySelectorAll(magazineClipboardExcludeSelector).forEach((element) => element.remove());
  node.querySelectorAll("script, style, button, textarea, input").forEach((element) => element.remove());
  node.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("href", new URL(anchor.getAttribute("href"), window.location.href).href);
  });
  node.querySelectorAll("[contenteditable]").forEach((element) => element.removeAttribute("contenteditable"));
}

export function isMagazineClipboardNbspSpacer(element) {
  return (
    element?.classList?.contains("magazine-copy-heading-spacer") ||
    element?.classList?.contains("magazine-copy-nbsp-spacer")
  );
}

export function trimMagazineClipboardTrailingWhitespace(element) {
  if (isMagazineClipboardNbspSpacer(element)) return;
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

export const magazineClipboardBlockLikeSelector = [
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

export const magazineClipboardWhitespaceContainerSelector = [
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

export function isMagazineClipboardBlockLikeNode(node) {
  return node?.nodeType === Node.ELEMENT_NODE && node.matches(magazineClipboardBlockLikeSelector);
}

export function shouldRemoveMagazineClipboardWhitespaceTextNode(textNode) {
  if (textNode.nodeValue.trim()) return false;
  const parent = textNode.parentElement;
  if (!parent || parent.closest("pre, code, textarea")) return false;
  if (isMagazineClipboardBlockLikeNode(textNode.previousSibling)) return true;
  if (isMagazineClipboardBlockLikeNode(textNode.nextSibling)) return true;
  return parent.matches(magazineClipboardWhitespaceContainerSelector);
}

export function normalizeMagazineClipboardTextWhitespace(node) {
  const textNodes = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }
  textNodes.forEach((textNode) => {
    if (textNode.parentElement?.closest(".magazine-copy-heading-spacer, .magazine-copy-nbsp-spacer")) return;
    textNode.nodeValue = textNode.nodeValue.replace(/\u00a0/g, " ");
    if (shouldRemoveMagazineClipboardWhitespaceTextNode(textNode)) {
      textNode.remove();
    }
  });
  node
    .querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, time")
    .forEach(trimMagazineClipboardTrailingWhitespace);
}

export function stripMagazineClipboardInternalMarkers(node) {
  node.querySelectorAll(".magazine-copy-heading-spacer, .magazine-copy-nbsp-spacer").forEach((element) => {
    element.classList.remove("magazine-copy-heading-spacer");
    element.classList.remove("magazine-copy-nbsp-spacer");
    if (!element.getAttribute("class")) {
      element.removeAttribute("class");
    }
  });
}

export function createMagazineClipboardSpacer() {
  const spacer = document.createElement("p");
  spacer.className = "magazine-copy-spacer";
  spacer.appendChild(document.createElement("br"));
  return spacer;
}

export function createMagazineClipboardNbspSpacer(className = "magazine-copy-nbsp-spacer") {
  const spacer = document.createElement("p");
  spacer.className = className;
  spacer.appendChild(document.createTextNode("\u00a0"));
  return spacer;
}

export function createMagazineClipboardHeadingSpacer({ trailingNbsp = false, withLineBreak = false } = {}) {
  const spacer = createMagazineClipboardNbspSpacer("magazine-copy-heading-spacer");
  if (withLineBreak) {
    spacer.appendChild(document.createElement("br"));
    if (trailingNbsp) {
      spacer.appendChild(document.createTextNode("\u00a0"));
    }
  }
  return spacer;
}

export function nextMagazineClipboardElement(element) {
  let next = element.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && !next.textContent.trim()) {
    next = next.nextSibling;
  }
  return next?.nodeType === Node.ELEMENT_NODE ? next : null;
}

export function addMagazineClipboardBlockquoteLeadBreak(container) {
  const lead = container.firstElementChild;
  if (!lead?.matches("strong, b")) return false;
  const firstBreak = nextMagazineClipboardElement(lead);
  if (!firstBreak?.matches("br")) return false;
  const secondBreak = nextMagazineClipboardElement(firstBreak);
  if (secondBreak?.matches("br")) return true;
  firstBreak.insertAdjacentElement("afterend", document.createElement("br"));
  return true;
}

export function insertMagazineClipboardBlockquoteBreaks(node) {
  node
    .querySelectorAll(".magazine-reader-html blockquote, .magazine-reader-section blockquote, .magazine-reader-chart-section blockquote")
    .forEach((quote) => {
      if (addMagazineClipboardBlockquoteLeadBreak(quote)) return;
      const firstParagraph = quote.firstElementChild;
      if (firstParagraph?.matches("p")) {
        addMagazineClipboardBlockquoteLeadBreak(firstParagraph);
      }
    });
}

export function insertMagazineClipboardFigureCreditBreak(node) {
  const figure = node.querySelector(".magazine-reader-figure");
  if (!figure?.querySelector("figcaption")) return;
  const nextElement = nextMagazineClipboardElement(figure);
  if (!nextElement?.classList?.contains("magazine-reader-body")) return;
  if (!nextElement.querySelector("p")) return;
  figure.insertAdjacentElement("afterend", createMagazineClipboardNbspSpacer());
}

export function insertMagazineClipboardBreaks(node) {
  [
    ".magazine-reader-published-time",
    ".magazine-reader-summary",
  ].forEach((selector) => {
    const element = node.querySelector(selector);
    if (!element) return;
    element.insertAdjacentElement("afterend", createMagazineClipboardSpacer());
  });
  node.querySelectorAll("h2").forEach((heading) => {
    heading.insertAdjacentElement("beforebegin", createMagazineClipboardHeadingSpacer({ trailingNbsp: true, withLineBreak: true }));
    heading.insertAdjacentElement("afterend", createMagazineClipboardHeadingSpacer());
  });
  insertMagazineClipboardFigureCreditBreak(node);
  insertMagazineClipboardBlockquoteBreaks(node);
  node
    .querySelectorAll(".magazine-reader-html p, .magazine-reader-section p, .magazine-reader-chart-section p")
    .forEach((paragraph) => {
      if (
        paragraph.classList.contains("magazine-copy-spacer") ||
        paragraph.classList.contains("magazine-copy-heading-spacer") ||
        paragraph.closest("blockquote, figure, figcaption")
      ) {
        return;
      }
      const nextElement = nextMagazineClipboardElement(paragraph);
      if (!nextElement || !nextElement.matches("p, blockquote, ul, ol")) return;
      paragraph.insertAdjacentElement("afterend", createMagazineClipboardSpacer());
    });
  node
    .querySelectorAll(".magazine-reader-html blockquote, .magazine-reader-section blockquote, .magazine-reader-chart-section blockquote")
    .forEach((quote) => {
      const nextElement = nextMagazineClipboardElement(quote);
      if (nextElement?.classList?.contains("magazine-copy-spacer")) return;
      quote.insertAdjacentElement("afterend", createMagazineClipboardSpacer());
    });
}

export function normalizeMagazineClipboardBodyHtml(node) {
  node.querySelectorAll(".magazine-reader-html").forEach((body) => {
    if (body.children.length !== 1) return;
    const onlyChild = body.firstElementChild;
    if (!onlyChild?.matches("article.magazine-article")) return;
    onlyChild.replaceWith(...Array.from(onlyChild.childNodes));
  });
}

export function magazineClipboardProviderName(provider) {
  return provider === "antigravity-cli" ? "Antigravity" : "Codex";
}

export const MAGAZINE_CLIPBOARD_ATTRIBUTION_URL = "https://arca.live/b/stock/175140301";

export function magazineClipboardAttributionText(provider) {
  return `Stock Channel Magazine+에서 ${magazineClipboardProviderName(provider)}로 생성됨`;
}

export function appendMagazineClipboardAttribution(node, provider) {
  for (let index = 0; index < 3; index += 1) {
    const spacer = document.createElement("p");
    spacer.appendChild(document.createElement("br"));
    node.appendChild(spacer);
  }
  const attribution = document.createElement("p");
  attribution.className = "magazine-copy-attribution";
  const link = document.createElement("a");
  link.href = MAGAZINE_CLIPBOARD_ATTRIBUTION_URL;
  link.target = "_blank";
  link.textContent = "Stock Channel Magazine+";
  attribution.append(link, `에서 ${magazineClipboardProviderName(provider)}로 생성됨`);
  node.appendChild(attribution);
}

export function magazinePlainTextFromNode(node) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.style.whiteSpace = "pre-wrap";
  holder.appendChild(node.cloneNode(true));
  document.body.appendChild(holder);
  const text = holder.innerText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  holder.remove();
  return text;
}

export async function buildMagazineClipboardPayload(sourceNode, options = {}) {
  if (!sourceNode) throw new Error("복사할 기사 본문을 찾지 못했습니다.");
  const cloneNode = sourceNode.cloneNode(true);
  cleanMagazineClipboardNode(cloneNode);
  normalizeMagazineClipboardBodyHtml(cloneNode);
  insertMagazineClipboardBreaks(cloneNode);
  inlineMagazineClipboardCanvases(sourceNode, cloneNode);
  await inlineMagazineClipboardImages(sourceNode, cloneNode);
  normalizeMagazineClipboardTextWhitespace(cloneNode);
  stripMagazineClipboardInternalMarkers(cloneNode);
  const basePlainText = magazinePlainTextFromNode(cloneNode);
  appendMagazineClipboardAttribution(cloneNode, options.provider);
  const plainText = `${basePlainText}\n\n\n${magazineClipboardAttributionText(options.provider)}`.trim();
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

export async function writeMagazineArticleToClipboard(sourceNode, options = {}) {
  const payloadPromise = buildMagazineClipboardPayload(sourceNode, options);
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

export function normalizeMagazineCommentReply(reply) {
  if (!reply || typeof reply !== "object") return null;
  const text = String(reply.text || "").trim();
  const status = String(reply.status || (text ? "complete" : "waiting")).trim();
  return {
    id: reply.id || `reply-${Date.now()}`,
    author: reply.author || "매거진 편집자 AI",
    text,
    status,
    createdAt: reply.createdAt || "",
    biasEventIds: Array.isArray(reply.biasEventIds)
      ? reply.biasEventIds.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
  };
}

export function normalizeMagazineComment(comment) {
  if (!comment || typeof comment !== "object") return null;
  const text = String(comment.text || "").trim();
  if (!text) return null;
  return {
    id: comment.id || `comment-${Date.now()}`,
    author: comment.author || "사용자",
    text,
    createdAt: comment.createdAt || "",
    reply: normalizeMagazineCommentReply(comment.reply),
  };
}

export function normalizeMagazineCommentStore(payload, articleId = "") {
  const comments = Array.isArray(payload?.comments) ? payload.comments : [];
  return {
    articleId: payload?.articleId || articleId,
    updatedAt: payload?.updatedAt || "",
    commentCount: Number(payload?.commentCount || comments.length || 0),
    comments: comments.map(normalizeMagazineComment).filter(Boolean),
  };
}

export function magazineCommentStatusText(status) {
  if (status === "waiting") return "답변 대기 중";
  if (status === "generating") return "답변 중";
  if (status === "error") return "답변 실패";
  return "";
}
