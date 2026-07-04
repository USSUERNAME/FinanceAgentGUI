function compactWorldMemoryText(value, maxLength = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function worldMemoryAskSectionLabel(section) {
  if (section === "memory-change") return "월드 메모리 변경 제안";
  return section === "signal" ? "시장 신호 점수" : "주제별 변화";
}

function worldMemoryAskItemTitle(section, item = {}) {
  if (section === "signal") return String(item.label || "시장 신호").trim();
  if (section === "memory-change") return compactWorldMemoryText(item.text || item.body || item.title || "변경 제안", 80);
  return String(item.title || item.tag || "주제 변화").trim();
}

function worldMemoryAskItemForContext(section, item = {}, extra = {}) {
  if (section === "signal") {
    return {
      section: worldMemoryAskSectionLabel(section),
      label: compactWorldMemoryText(item.label || "", 100),
      score: extra.score ?? item.score ?? "",
      tone: compactWorldMemoryText(item.tone || "", 40),
      note: compactWorldMemoryText(item.note || "", 320),
    };
  }

  if (section === "memory-change") {
    const text = String(item.text || item.body || item.title || "").trim();
    return {
      section: worldMemoryAskSectionLabel(section),
      index: extra.index ?? item.index ?? "",
      text: compactWorldMemoryText(text, 1400),
      suggestion: compactWorldMemoryText(text, 520),
      source: "report.view.memoryChangeSuggestions",
      decisionState: "pending-user-decision",
    };
  }

  return {
    section: worldMemoryAskSectionLabel(section),
    tag: compactWorldMemoryText(item.tag || "", 80),
    title: compactWorldMemoryText(item.title || "", 160),
    body: compactWorldMemoryText(item.body || "", 420),
    importance: compactWorldMemoryText(item.importance || "", 40),
  };
}

export function buildWorldMemoryAskRequest(section, item = {}, extra = {}) {
  const title = worldMemoryAskItemTitle(section, item);
  const contextItem = worldMemoryAskItemForContext(section, item, extra);
  const sectionLabel = worldMemoryAskSectionLabel(section);
  const vectorSearchQuery = [
    title,
    item.note,
    item.body,
    item.tag,
    item.tone,
    item.importance,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  const isMemoryChange = section === "memory-change";
  const displayText = isMemoryChange ? `${sectionLabel} 검토 · ${title}` : `${sectionLabel} 설명 · ${title}`;
  const promptText = [
    isMemoryChange ? "다음 World Memory 변경 제안을 검토해 주세요." : "다음 World Memory 보고서 항목을 설명해 주세요.",
    "",
    isMemoryChange
      ? "목적: 사용자가 이 변경 제안을 수용할지, 보류/거절할지, 또는 제3의 대안을 낼지 판단할 수 있게 돕는 것입니다."
      : "목적: 사용자가 선택한 이슈를 이해하기 쉽게 설명하는 것입니다. 실행 제안이나 DB 변경보다 설명을 우선하세요.",
    "필수 절차:",
    "- 현재 World Memory 페이지 컨텍스트를 먼저 참고하세요.",
    "- 서버가 첨부한 World Memory semantic-search 결과를 반드시 함께 사용하세요.",
    isMemoryChange
      ? "- 현재 월드메모리 story/state/taxonomy 맥락에서 이 제안이 무엇을 바꾸려는지 먼저 설명하세요."
      : "- 가능한 경우 웹 검색 또는 grounding으로 최신 기사/원출처를 확인하고, 월드 메모리 저장소 내용과 최신 웹 근거를 구분해서 설명하세요.",
    isMemoryChange
      ? "- 이 변경이 좋을 수 있는 이유, 보류하거나 반대할 이유, 필요한 확인 데이터를 분리해서 설명하세요. 단, 수용 추천 문단 안에 보류/거절 문장을 섞지 마세요."
      : "",
    isMemoryChange
      ? "- 선택지는 번호 목록 대신 굵은 라벨 3개로만 쓰세요: **수용 추천**, **보류/거절**, **대안 제시**. 각 라벨 바로 뒤 한 문단에만 해당 설명을 붙이세요."
      : "",
    isMemoryChange
      ? "- **수용 추천**에는 '반영한다/업데이트한다/감시 state로 올린다'처럼 수용했을 때의 조치를 쓰고, '불확실하므로 나중에 판단' 같은 보류 문장은 반드시 **보류/거절**에만 넣으세요."
      : "",
    isMemoryChange
      ? "- 사용자가 이후 수용/승인/그렇게 하자/진행/대안 실행처럼 답하면 의미 기반으로 의도를 분류하고, 가능한 경우 반드시 마지막에 ```world_memory_action 코드펜스를 하나 제안하세요. 실행됐다고 말하지 말고 GUI 확인 버튼으로 실행될 제안이라고 말하세요."
      : "",
    isMemoryChange
      ? "- orphan brief backfill, story fill rate 개선, 특정 brief를 story/family에 묶는 제안은 eventId를 확인한 뒤 briefStoryBackfill을 우선 사용하세요. watch state로 수용하면 action은 stateSync가 아니라 stateAdd를 우선 사용하세요. stateSync는 기존 로그에서 파생 상태를 재동기화할 때만 사용합니다."
      : "",
    isMemoryChange
      ? "- 구조 수정 뒤 변경 제안 목록 갱신이 필요하면 report 또는 collectNow 같은 후속 갱신 절차를 설명하세요."
      : "",
    "- 데이터에 없는 가격, 수익률, 보유 수량, 세무 조건은 꾸며내지 마세요.",
    "",
    "[선택 항목]",
    JSON.stringify(contextItem, null, 2),
    "",
    isMemoryChange
      ? "답변 형식: 현재 메모리 상황, 바꾸면 좋은 이유, 보류/반대 이유, 선택지 순서로 정리하세요. 선택지 섹션은 **수용 추천** / **보류 또는 거절** / **대안 제시** 라벨만 사용하고 번호 목록은 쓰지 마세요."
      : "답변 형식: 핵심 요지, 왜 중요한지, 확인해야 할 데이터, 리스크/반대 시나리오 순서로 간결하게 정리하세요.",
  ].filter(Boolean).join("\n");

  return {
    displayText,
    promptText,
    vectorSearchQuery: vectorSearchQuery || title,
    requireWebSearch: !isMemoryChange,
    focusContext: {
      source: "world-memory-report-item",
      section,
      sectionLabel,
      item: contextItem,
    },
  };
}
