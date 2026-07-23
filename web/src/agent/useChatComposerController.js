import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { fetchArcaArticle } from "../arca/arcaApi.js";
import { normalizePortfolioChatMessages } from "../portfolio/workspaceState.js";
import { formatFileSize } from "../utils/formatters.js";
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_HEIGHT,
  MIN_PROMPT_HEIGHT,
  chatScopeKey,
  fileToChatAttachment,
  initialChatMessages,
  isWorldMemoryChatScope,
  normalizeChatMessageList,
  systemMainChatScope,
  worldMemoryChatScope,
} from "./chatSessionModel.js";

export function useChatComposerController({
  activeChatScope,
  activePortfolioCanvas,
  isPortfolioCanvasView,
  isWorldMemoryChatView,
  portfolioCanvases,
  updatePortfolioCanvasChatMessages,
}) {
  const [chatMessages, setChatMessages] = useState(initialChatMessages);
  const [worldMemoryChatMessages, setWorldMemoryChatMessages] = useState(initialChatMessages);
  const [prompt, setPrompt] = useState("");
  const [worldMemoryPrompt, setWorldMemoryPrompt] = useState("");
  const [sendingChatScopes, setSendingChatScopes] = useState({});
  const [promptHeight, setPromptHeight] = useState(MIN_PROMPT_HEIGHT);
  const [promptOverflow, setPromptOverflow] = useState(false);
  const [attachedArticle, setAttachedArticle] = useState(null);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [worldMemoryChatAttachments, setWorldMemoryChatAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [worldMemoryAttachmentError, setWorldMemoryAttachmentError] = useState("");
  const [isComposerDragging, setIsComposerDragging] = useState(false);
  const [attachingArticleHref, setAttachingArticleHref] = useState("");
  const activeChatAbortRefs = useRef(new Map());
  const messageStackRef = useRef(null);
  const promptRef = useRef(null);
  const fileInputRef = useRef(null);

  function isChatScopeSending(scope) {
    return Boolean(sendingChatScopes[chatScopeKey(scope)]);
  }

  function setChatScopeSending(scope, sending) {
    const key = chatScopeKey(scope);
    setSendingChatScopes((current) => {
      if (sending) {
        return current[key] ? current : { ...current, [key]: true };
      }
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function promptForScope(scope) {
    return isWorldMemoryChatScope(scope) ? worldMemoryPrompt : prompt;
  }

  function setPromptForScope(scope, value) {
    if (isWorldMemoryChatScope(scope)) {
      setWorldMemoryPrompt(value);
      return;
    }
    setPrompt(value);
  }

  function attachmentsForScope(scope) {
    return isWorldMemoryChatScope(scope) ? worldMemoryChatAttachments : chatAttachments;
  }

  function setAttachmentsForScope(scope, updater) {
    const setter = isWorldMemoryChatScope(scope) ? setWorldMemoryChatAttachments : setChatAttachments;
    setter((current) => {
      const nextAttachments = typeof updater === "function" ? updater(current) : updater;
      return Array.isArray(nextAttachments) ? nextAttachments : [];
    });
  }

  function attachmentErrorForScope(scope) {
    return isWorldMemoryChatScope(scope) ? worldMemoryAttachmentError : attachmentError;
  }

  function setAttachmentErrorForScope(scope, value) {
    if (isWorldMemoryChatScope(scope)) {
      setWorldMemoryAttachmentError(value);
      return;
    }
    setAttachmentError(value);
  }

  function attachedArticleForScope(scope) {
    return isWorldMemoryChatScope(scope) ? null : attachedArticle;
  }

  function clearAttachedArticleForScope(scope) {
    if (isWorldMemoryChatScope(scope)) return;
    setAttachedArticle(null);
  }

  function clearComposerForScope(scope) {
    setPromptForScope(scope, "");
    setAttachmentsForScope(scope, []);
    setAttachmentErrorForScope(scope, "");
    clearAttachedArticleForScope(scope);
  }

  function updateChatMessagesForScope(scope, updater) {
    if (scope?.type === "portfolio-canvas" && scope.canvasId) {
      updatePortfolioCanvasChatMessages(scope.canvasId, updater);
      return;
    }
    if (isWorldMemoryChatScope(scope)) {
      setWorldMemoryChatMessages((messages) => {
        const nextMessages = typeof updater === "function" ? updater(messages) : updater;
        return normalizeChatMessageList(nextMessages);
      });
      return;
    }
    setChatMessages((messages) => {
      const nextMessages = typeof updater === "function" ? updater(messages) : updater;
      return normalizeChatMessageList(nextMessages);
    });
  }

  function chatMessagesForScope(scope) {
    if (scope?.type === "portfolio-canvas" && scope.canvasId) {
      const canvas = portfolioCanvases.find((item) => item.id === scope.canvasId);
      return normalizePortfolioChatMessages(canvas?.chatMessages);
    }
    if (isWorldMemoryChatScope(scope)) {
      return normalizeChatMessageList(worldMemoryChatMessages);
    }
    return chatMessages;
  }

  function startNewChat() {
    updateChatMessagesForScope(activeChatScope, initialChatMessages);
    clearComposerForScope(activeChatScope);
  }

  function resolveChatScope(screen) {
    if ((screen === "portfolio-canvas" || screen === "portfolio") && isPortfolioCanvasView && activePortfolioCanvas) {
      return { type: "portfolio-canvas", canvasId: activePortfolioCanvas.id };
    }
    if (screen === "world-memory") {
      return worldMemoryChatScope;
    }
    return systemMainChatScope;
  }

  async function attachArticleContext(row) {
    if (!row?.href || attachingArticleHref) return;
    setAttachingArticleHref(row.href);
    try {
      const payload = await fetchArcaArticle(row.href);
      setAttachedArticle({
        ...payload.article,
        id: row.id,
        number: row.number,
        title: payload.article?.title || row.title,
        author: payload.article?.author || row.author,
        url: payload.article?.url || row.href,
        href: row.href,
      });
      promptRef.current?.focus();
    } catch (error) {
      setAttachedArticle({
        id: row.id,
        number: row.number,
        title: row.title,
        author: row.author,
        url: row.href,
        href: row.href,
        error: `본문을 가져오지 못했습니다: ${error.message}`,
      });
    } finally {
      setAttachingArticleHref("");
    }
  }

  async function addChatAttachmentFiles(fileList) {
    const scope = activeChatScope;
    const scopeAttachments = attachmentsForScope(scope);
    const incoming = Array.from(fileList || []).filter((file) => file && typeof file.size === "number");
    if (!incoming.length) return;

    setAttachmentErrorForScope(scope, "");
    const remainingSlots = MAX_CHAT_ATTACHMENTS - scopeAttachments.length;
    if (remainingSlots <= 0) {
      setAttachmentErrorForScope(scope, `첨부는 최대 ${MAX_CHAT_ATTACHMENTS}개까지 가능합니다.`);
      return;
    }

    const accepted = [];
    const rejected = [];
    let totalBytes = scopeAttachments.reduce((sum, item) => sum + Number(item.size || 0), 0);

    for (const file of incoming.slice(0, remainingSlots)) {
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected.push(`${file.name || "파일"}: ${formatFileSize(MAX_CHAT_ATTACHMENT_BYTES)} 초과`);
        continue;
      }
      if (totalBytes + file.size > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
        rejected.push(`${file.name || "파일"}: 전체 ${formatFileSize(MAX_CHAT_ATTACHMENT_TOTAL_BYTES)} 제한 초과`);
        continue;
      }
      accepted.push(file);
      totalBytes += file.size;
    }

    if (incoming.length > remainingSlots) {
      rejected.push(`최대 ${MAX_CHAT_ATTACHMENTS}개 제한으로 ${incoming.length - remainingSlots}개 제외`);
    }
    if (rejected.length) {
      setAttachmentErrorForScope(scope, rejected.join(" / "));
    }
    if (!accepted.length) return;

    try {
      const nextAttachments = await Promise.all(accepted.map(fileToChatAttachment));
      setAttachmentsForScope(scope, (current) => [...current, ...nextAttachments].slice(0, MAX_CHAT_ATTACHMENTS));
      promptRef.current?.focus();
    } catch (error) {
      setAttachmentErrorForScope(scope, error.message || "첨부 파일을 읽지 못했습니다.");
    }
  }

  function removeChatAttachment(id) {
    setAttachmentsForScope(activeChatScope, (current) => current.filter((attachment) => attachment.id !== id));
    setAttachmentErrorForScope(activeChatScope, "");
  }

  function hasFileTransfer(event) {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  }

  function handleComposerDragEnter(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    setIsComposerDragging(true);
  }

  function handleComposerDragOver(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsComposerDragging(true);
  }

  function handleComposerDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsComposerDragging(false);
  }

  function handleComposerDrop(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    setIsComposerDragging(false);
    void addChatAttachmentFiles(event.dataTransfer.files);
  }

  function handleComposerPaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void addChatAttachmentFiles(files);
  }

  function stopActiveChatResponse(scope = activeChatScope) {
    activeChatAbortRefs.current.get(chatScopeKey(scope))?.abort();
  }

  const visibleChatMessages = isPortfolioCanvasView
    ? activePortfolioCanvas.chatMessages
    : isWorldMemoryChatView
      ? worldMemoryChatMessages
      : chatMessages;
  const activePrompt = promptForScope(activeChatScope);
  const activeChatAttachments = attachmentsForScope(activeChatScope);
  const activeAttachmentError = attachmentErrorForScope(activeChatScope);
  const activeAttachedArticle = attachedArticleForScope(activeChatScope);
  const isSending = isChatScopeSending(activeChatScope);
  const activePortfolioChatIsSending = isPortfolioCanvasView ? isSending : false;
  const worldMemoryChatIsSending = isChatScopeSending(worldMemoryChatScope);

  useEffect(() => {
    const stack = messageStackRef.current;
    if (!stack) return;
    stack.scrollTop = stack.scrollHeight;
  }, [visibleChatMessages]);

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, MIN_PROMPT_HEIGHT),
      MAX_PROMPT_HEIGHT,
    );
    setPromptHeight(nextHeight);
    setPromptOverflow(textarea.scrollHeight > MAX_PROMPT_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
  }, [activePrompt]);

  return {
    chatMessages,
    setChatMessages,
    worldMemoryChatMessages,
    activeChatAbortRefs,
    promptHeight,
    promptOverflow,
    isComposerDragging,
    attachingArticleHref,
    messageStackRef,
    promptRef,
    fileInputRef,
    visibleChatMessages,
    activePrompt,
    activeChatAttachments,
    activeAttachmentError,
    activeAttachedArticle,
    isSending,
    activePortfolioChatIsSending,
    worldMemoryChatIsSending,
    isChatScopeSending,
    setChatScopeSending,
    promptForScope,
    setPromptForScope,
    attachmentsForScope,
    setAttachmentsForScope,
    setAttachmentErrorForScope,
    attachedArticleForScope,
    clearAttachedArticleForScope,
    clearComposerForScope,
    updateChatMessagesForScope,
    chatMessagesForScope,
    startNewChat,
    resolveChatScope,
    attachArticleContext,
    addChatAttachmentFiles,
    removeChatAttachment,
    handleComposerDragEnter,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
    handleComposerPaste,
    stopActiveChatResponse,
  };
}
