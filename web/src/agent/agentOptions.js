export const fallbackApprovalOptions = [
  {
    id: "on-request",
    label: "요청시 승인",
    cli: "--ask-for-approval on-request",
    detail: "Codex가 필요하다고 판단한 작업에 대해 사용자 승인을 요청합니다.",
  },
  {
    id: "untrusted",
    label: "신뢰 명령만",
    cli: "--ask-for-approval untrusted",
    detail: "안전한 읽기 명령 위주로 허용하고 나머지는 승인 흐름을 탑니다.",
  },
  {
    id: "never",
    label: "승인 없음",
    cli: "--ask-for-approval never",
    detail: "진단 전용 또는 제한된 allowlist 실행에만 사용해야 합니다.",
  },
];

export const standardSpeedOption = {
  id: "standard",
  label: "표준",
  cli: "",
  detail: "기본 Codex CLI 속도입니다.",
};

const loadingSpeedOption = {
  id: "loading",
  label: "대기",
  cli: "",
  detail: "저장된 에이전트 설정을 불러오고 있습니다.",
};

export const loadingApprovalOptions = [
  {
    id: "loading",
    label: "설정 로드",
    cli: "",
    detail: "저장된 에이전트 설정을 불러오고 있습니다.",
  },
];

export const loadingModelGroups = [
  {
    id: "loading",
    slug: "loading",
    label: "설정 로드",
    displayName: "설정 불러오는 중",
    defaultReasoningLevel: "loading",
    reasoningLevels: [
      {
        id: "loading",
        label: "대기",
        cli: "",
        detail: "저장된 에이전트 설정을 불러오고 있습니다.",
      },
    ],
    speedOptions: [loadingSpeedOption],
  },
];

export const fallbackProviderOptions = [
  {
    id: "codex-cli",
    label: "Codex CLI",
    available: false,
    status: "checking",
    detail: "Codex CLI 확인 중",
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    available: false,
    status: "checking",
    detail: "Antigravity CLI 확인 중",
    installCommand: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  },
];

export const personaModeOptions = [
  {
    id: "none",
    label: "사용하지 않음",
    detail: "일반 채팅과 Earning Calendar 분석을 기본 업무 응답으로 유지합니다.",
  },
  {
    id: "choi-hayoung",
    label: "최하영",
    detail: "일반 채팅에는 최하영 톤을, Earning Calendar 분석에는 하영·명희 통합 정본을 적용합니다.",
  },
  {
    id: "won-myunghee",
    label: "원명희",
    detail: "일반 채팅에는 원명희 톤을, Earning Calendar 분석에는 하영·명희 통합 정본을 적용합니다.",
  },
];

export const emptyAgentSettings = {
  selectedProvider: "codex-cli",
  personaMode: "none",
  providers: {
    "codex-cli": {
      enabled: true,
    },
    "antigravity-cli": {
      enabled: false,
    },
  },
};

export const antigravityPolicyOptions = [
  {
    id: "default",
    label: "Default",
    cli: "",
    detail: "작업 폴더 기준 파일 정책을 유지하고, 터미널 실행과 범위 밖 접근은 승인 대상으로 둡니다.",
  },
  {
    id: "full-machine",
    label: "Full machine",
    cli: "",
    detail: "파일 접근 범위를 전체 머신으로 넓히되, 터미널 실행은 사용자 승인 흐름을 탑니다.",
  },
  {
    id: "turbo",
    label: "Turbo mode",
    cli: "--dangerously-skip-permissions",
    detail: "Antigravity CLI 권한 확인을 건너뛰는 고속 모드입니다. 신뢰한 작업에만 사용해야 합니다.",
  },
  {
    id: "custom",
    label: "Custom",
    cli: "",
    detail: "세부 policy와 capability 조합을 직접 지정하기 위한 자리입니다. 현재 GUI에서는 보수적으로 처리합니다.",
  },
];

export const fallbackModelGroups = [
  {
    id: "gpt-5.5",
    slug: "gpt-5.5",
    label: "5.5",
    displayName: "GPT-5.5",
    defaultReasoningLevel: "high",
    reasoningLevels: [
      {
        id: "low",
        label: "낮음",
        cli: '-c model_reasoning_effort="low"',
        detail: "Fast responses with lighter reasoning",
      },
      {
        id: "medium",
        label: "보통",
        cli: '-c model_reasoning_effort="medium"',
        detail: "Balances speed and reasoning depth for everyday tasks",
      },
      {
        id: "high",
        label: "높음",
        cli: '-c model_reasoning_effort="high"',
        detail: "Greater reasoning depth for complex problems",
      },
      {
        id: "xhigh",
        label: "매우 높음",
        cli: '-c model_reasoning_effort="xhigh"',
        detail: "Extra high reasoning depth for complex problems",
      },
    ],
    speedOptions: [standardSpeedOption],
  },
];

export const antigravityModelGroups = [
  {
    id: "Gemini 3.5 Flash (Medium)",
    slug: "Gemini 3.5 Flash (Medium)",
    label: "3.5 Flash",
    displayName: "Gemini 3.5 Flash (Medium)",
    defaultReasoningLevel: "medium",
    reasoningLevels: [
      {
        id: "medium",
        label: "보통",
        cli: "",
        detail: "Antigravity CLI 기본 모델입니다.",
      },
    ],
    reasoningEmbedded: true,
    reasoningControl: "model-variant",
    speedControl: "unsupported",
    speedOptions: [],
  },
];

const antigravityReasoningLevels = [
  {
    id: "minimal",
    label: "최소",
    cli: "",
    detail: "Gemini thinking level minimal",
  },
  {
    id: "low",
    label: "낮음",
    cli: "",
    detail: "Gemini thinking level low",
  },
  {
    id: "medium",
    label: "보통",
    cli: "",
    detail: "Gemini thinking level medium",
  },
  {
    id: "high",
    label: "높음",
    cli: "",
    detail: "Gemini thinking level high",
  },
  {
    id: "thinking",
    label: "사고 모드 (Thinking)",
    cli: "",
    detail: "모델 이름에 포함된 Antigravity 사고 모드입니다.",
  },
];

function labelAntigravityModel(name) {
  return String(name || "")
    .replace(/^gemini-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .replace(/\bPro\b/g, "Pro")
    .replace(/\bFlash\b/g, "Flash")
    .replace(/\bLite\b/g, "Lite");
}

export function modelGroupsFromAntigravityCatalog(catalog) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const groups = models
    .filter((item) => item?.selectable && item?.name)
    .map((item) => {
      const reasoningLevel = item.reasoningLevel?.toLowerCase() || "medium";
      const reasoningOption = antigravityReasoningLevels.find((option) => option.id === reasoningLevel) || {
        id: reasoningLevel,
        label: reasoningLevel,
        cli: "",
        detail: "모델 이름에 포함된 Antigravity CLI 추론 수준입니다.",
      };
      return {
        id: item.name,
        slug: item.name,
        label: labelAntigravityModel(item.name),
        displayName: item.displayName || item.name,
        description: "Antigravity CLI model returned by agy models.",
        defaultReasoningLevel: reasoningLevel,
        reasoningLevels: [reasoningOption],
        reasoningEmbedded: true,
        reasoningControl: "model-variant",
        speedControl: "unsupported",
        speedOptions: [],
      };
    });
  return groups.length ? groups : antigravityModelGroups;
}

export function getSpeedOptions(modelGroup) {
  const options = Array.isArray(modelGroup?.speedOptions) ? modelGroup.speedOptions : [];
  const seen = new Set(["standard"]);
  return [
    standardSpeedOption,
    ...options.filter((option) => {
      const id = String(option?.id || "").trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  ];
}

export function getSpeedOptionsForReasoning(modelGroup, reasoning) {
  const reasoningId = String(reasoning || modelGroup?.defaultReasoningLevel || "").trim();
  return getSpeedOptions(modelGroup).filter((option) => {
    if (option.id === "standard") return true;
    const supported = Array.isArray(option.supportedReasoningLevels)
      ? option.supportedReasoningLevels
      : [];
    return !supported.length || supported.includes(reasoningId);
  });
}
