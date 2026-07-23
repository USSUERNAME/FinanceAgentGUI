import { ANTIGRAVITY_PROVIDER_ID } from "./agentProviderIds.js";
import { CHAT_STREAM_RENDER_INTERVAL_MS } from "./chatSessionModel.js";
import { parseSseEvent } from "./chatProtocol.js";

function initialStatus(runtime, mode) {
  const earning = mode === "earning";
  return {
    type: "status",
    tone: "working",
    title: earning ? `${runtime.providerLabel} 어닝 분석 준비 중` : `${runtime.providerLabel} 응답 준비 중`,
    body:
      runtime.provider === ANTIGRAVITY_PROVIDER_ID
        ? `${runtime.selectedModelGroup?.label || "Gemini"} · ${runtime.selectedApproval?.label || "Default"} 권한으로 ${earning ? "이벤트" : "대화"} 컨텍스트를 전달하고 있습니다.`
        : `${runtime.modelSummaryLabel} 모델을 읽기 전용 Codex CLI 세션으로 호출하고 있습니다.`,
  };
}

function statusForEvent(event, runtime, mode, currentStatus) {
  const data = event.data || {};
  const earning = mode === "earning";
  if (event.type === "started") {
    const providerName = data.providerLabel || runtime.providerLabel;
    return {
      type: "status",
      tone: "working",
      title: earning ? `${providerName} 어닝 분석 시작` : `${providerName} 세션 시작`,
      body: [
        data.model || runtime.selectedModelGroup?.slug,
        data.reasoning || runtime.selectedReasoning?.id,
        data.approval || runtime.selectedApproval?.label,
      ].filter(Boolean).join(" · "),
    };
  }
  if (event.type === "status") {
    return {
      type: "status",
      tone: "working",
      title: data.title || (earning ? `${runtime.providerLabel} 어닝 분석 중` : `${runtime.providerLabel} 응답 생성 중`),
      body:
        data.body ||
        (earning
          ? `${runtime.providerLabel}가 이벤트 발생 여부와 관련 자료를 확인하고 있습니다.`
          : `${runtime.providerLabel}가 요청을 처리하고 있습니다.`),
    };
  }
  if (event.type === "message") {
    return {
      type: "status",
      tone: "working",
      title: earning ? "어닝 분석 수신 중" : "응답 수신 중",
      body: `${data.providerLabel || runtime.providerLabel}에서 최종 메시지를 받았습니다.`,
    };
  }
  if (event.type === "done") {
    return {
      type: "status",
      tone: "done",
      title: earning
        ? `${data.providerLabel || runtime.providerLabel} 어닝 분석`
        : `${data.providerLabel || runtime.providerLabel} 응답`,
      body: `${data.model || runtime.selectedModelGroup?.slug} · ${data.reasoning || runtime.selectedReasoning?.id} · ${Math.max(1, Math.round((data.elapsedMs || 0) / 1000))}초`,
    };
  }
  return currentStatus;
}

function streamError(error, partialText) {
  const nextError = error instanceof Error ? error : new Error(String(error || "Agent stream failed"));
  try {
    nextError.partialText = partialText;
  } catch {
    // The original error remains useful even if it is non-extensible.
  }
  return nextError;
}

export async function consumeAgentChatStream(response, {
  runtime,
  mode = "chat",
  transformText = (text) => text,
  onRender = () => {},
  onFirstDelta,
  onRawText,
} = {}) {
  if (!response?.ok) {
    const payload = typeof response?.json === "function"
      ? await response.json().catch(() => ({}))
      : {};
    throw new Error(payload?.error || `HTTP ${response?.status || 500}`);
  }
  if (!response.body) {
    throw new Error("Streaming response body is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  let latestStatus = initialStatus(runtime, mode);
  let streamRenderTimer = null;
  let lastStreamRenderAt = 0;
  let firstAssistantTokenSeen = false;

  const notifyRawText = () => {
    if (typeof onRawText === "function") onRawText(streamedText);
  };
  const notifyFirstAssistantToken = () => {
    if (firstAssistantTokenSeen) return;
    firstAssistantTokenSeen = true;
    if (typeof onFirstDelta === "function") onFirstDelta();
  };
  const renderAssistantStreamText = ({ immediate = false } = {}) => {
    const render = () => {
      if (streamRenderTimer) {
        globalThis.clearTimeout(streamRenderTimer);
        streamRenderTimer = null;
      }
      lastStreamRenderAt = Date.now();
      onRender({
        status: latestStatus,
        text: transformText(streamedText),
        rawText: streamedText,
      });
    };
    if (immediate) {
      render();
      return;
    }
    const waitMs = CHAT_STREAM_RENDER_INTERVAL_MS - (Date.now() - lastStreamRenderAt);
    if (waitMs <= 0) {
      render();
      return;
    }
    if (!streamRenderTimer) {
      streamRenderTimer = globalThis.setTimeout(render, waitMs);
    }
  };

  function applyStreamEvent(event) {
    const data = event.data || {};
    if (event.type === "error") {
      throw new Error(data.error || `${runtime.providerLabel} stream failed`);
    }
    if (event.type === "started" || event.type === "status") {
      latestStatus = statusForEvent(event, runtime, mode, latestStatus);
      renderAssistantStreamText({ immediate: true });
      return;
    }
    if (event.type === "delta") {
      const deltaText = data.text || data.delta || "";
      if (deltaText) notifyFirstAssistantToken();
      streamedText += deltaText;
      notifyRawText();
      renderAssistantStreamText();
      return;
    }
    if (event.type === "message") {
      if (data.text) notifyFirstAssistantToken();
      streamedText = data.text || streamedText;
      notifyRawText();
      latestStatus = statusForEvent(event, runtime, mode, latestStatus);
      renderAssistantStreamText({ immediate: true });
      return;
    }
    if (event.type === "done") {
      if (data.answer || streamedText) notifyFirstAssistantToken();
      streamedText = data.answer || streamedText || "응답이 비어 있습니다.";
      notifyRawText();
      latestStatus = statusForEvent(event, runtime, mode, latestStatus);
      renderAssistantStreamText({ immediate: true });
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || "";
      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;
        applyStreamEvent(parseSseEvent(rawEvent));
      }
    }

    const tail = buffer + decoder.decode();
    if (tail.trim()) {
      applyStreamEvent(parseSseEvent(tail));
    }
    renderAssistantStreamText({ immediate: true });
    return {
      answer: streamedText.trim(),
      rawText: streamedText,
      latestStatus,
    };
  } catch (error) {
    renderAssistantStreamText({ immediate: true });
    throw streamError(error, streamedText);
  } finally {
    if (streamRenderTimer) {
      globalThis.clearTimeout(streamRenderTimer);
    }
  }
}
