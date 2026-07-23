import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMagazineArticle,
  fetchMagazineComments,
  fetchMagazinePreferences,
  saveMagazinePreference as saveMagazinePreferenceRequest,
  submitMagazineComment as submitMagazineCommentRequest,
} from "./magazineApi.js";

export function useMagazineReaderController({
  activeView,
  topicCatalog,
  applyCatalogPayload,
  getWritingRuntime,
  normalizeArticle,
  normalizeComment,
  normalizeCommentStore,
  writeArticleToClipboard,
}) {
  const [magazineActiveArticle, setMagazineActiveArticle] = useState(null);
  const [magazineActiveTopic, setMagazineActiveTopic] = useState("");
  const [magazinePreferenceStore, setMagazinePreferenceStore] = useState(null);
  const [magazinePreferenceSavingId, setMagazinePreferenceSavingId] = useState("");
  const [magazinePreferenceNotice, setMagazinePreferenceNotice] = useState("");
  const [magazinePreferenceNoticeFading, setMagazinePreferenceNoticeFading] = useState(false);
  const [magazineCommentStore, setMagazineCommentStore] = useState(null);
  const [magazineCommentDraft, setMagazineCommentDraft] = useState("");
  const [magazineCommentSubmitting, setMagazineCommentSubmitting] = useState(false);
  const [magazineCommentError, setMagazineCommentError] = useState("");
  const [magazineDeleteDialogOpen, setMagazineDeleteDialogOpen] = useState(false);
  const [magazineDeleting, setMagazineDeleting] = useState(false);
  const [magazineDeleteError, setMagazineDeleteError] = useState("");
  const [magazineCopyStatus, setMagazineCopyStatus] = useState("idle");
  const [magazineCopyError, setMagazineCopyError] = useState("");

  const magazineCanvasRef = useRef(null);
  const magazineTopicModalRef = useRef(null);
  const magazineReaderArticleRef = useRef(null);
  const magazineReturnScrollRef = useRef({ canvasTop: 0, topicTop: 0, hadTopic: false });
  const deletingRef = useRef(false);
  const submittingRef = useRef(false);
  const copyingRef = useRef(false);

  const openMagazineTopic = useCallback((event, topicLabel) => {
    event.preventDefault();
    magazineCanvasRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setMagazineActiveArticle(null);
    setMagazineDeleteDialogOpen(false);
    setMagazineDeleting(false);
    setMagazineDeleteError("");
    setMagazineActiveTopic(topicLabel);
  }, []);

  const closeMagazineTopic = useCallback((event) => {
    event?.preventDefault();
    setMagazineActiveTopic("");
  }, []);

  const openMagazineArticle = useCallback((event, article) => {
    event?.preventDefault();
    magazineReturnScrollRef.current = {
      canvasTop: magazineCanvasRef.current?.scrollTop ?? 0,
      topicTop: magazineTopicModalRef.current?.scrollTop ?? 0,
      hadTopic: Boolean(magazineActiveTopic),
    };
    setMagazinePreferenceNotice("");
    setMagazinePreferenceNoticeFading(false);
    setMagazineCommentDraft("");
    setMagazineCommentError("");
    setMagazineCommentStore(null);
    setMagazineCopyStatus("idle");
    setMagazineCopyError("");
    setMagazineActiveArticle(normalizeArticle(article));
  }, [magazineActiveTopic, normalizeArticle]);

  const closeMagazineArticle = useCallback(() => {
    const returnScroll = magazineReturnScrollRef.current;
    setMagazinePreferenceNotice("");
    setMagazinePreferenceNoticeFading(false);
    setMagazineCommentDraft("");
    setMagazineCommentError("");
    setMagazineCommentStore(null);
    setMagazineDeleteDialogOpen(false);
    setMagazineDeleting(false);
    deletingRef.current = false;
    setMagazineDeleteError("");
    setMagazineCopyStatus("idle");
    copyingRef.current = false;
    setMagazineCopyError("");
    setMagazineActiveArticle(null);
    window.requestAnimationFrame(() => {
      if (magazineCanvasRef.current) magazineCanvasRef.current.scrollTop = returnScroll.canvasTop;
      if (returnScroll.hadTopic && magazineTopicModalRef.current) {
        magazineTopicModalRef.current.scrollTop = returnScroll.topicTop;
      }
    });
  }, []);

  const openMagazineDeleteDialog = useCallback(() => {
    setMagazineDeleteError("");
    setMagazineDeleteDialogOpen(true);
  }, []);

  const closeMagazineDeleteDialog = useCallback(() => {
    if (deletingRef.current) return;
    setMagazineDeleteDialogOpen(false);
    setMagazineDeleteError("");
  }, []);

  const copyMagazineArticle = useCallback(async () => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setMagazineCopyStatus("copying");
    setMagazineCopyError("");
    try {
      const runtime = getWritingRuntime();
      const result = await writeArticleToClipboard(magazineReaderArticleRef.current, {
        provider: magazineActiveArticle?.generationAgent?.provider || runtime.provider,
      });
      setMagazineCopyStatus(result.mode === "text" ? "text" : "copied");
      setMagazineCopyError(result.warning || "");
      window.setTimeout(() => {
        copyingRef.current = false;
        setMagazineCopyStatus("idle");
        setMagazineCopyError("");
      }, 2200);
    } catch (error) {
      copyingRef.current = false;
      setMagazineCopyStatus("error");
      setMagazineCopyError(error.message || "기사를 복사하지 못했습니다.");
    }
  }, [getWritingRuntime, magazineActiveArticle, writeArticleToClipboard]);

  const confirmMagazineArticleDelete = useCallback(async () => {
    if (!magazineActiveArticle?.id || deletingRef.current) return;
    deletingRef.current = true;
    setMagazineDeleting(true);
    setMagazineDeleteError("");
    try {
      const payload = await deleteMagazineArticle(magazineActiveArticle.id);
      applyCatalogPayload(payload);
      closeMagazineArticle();
    } catch (error) {
      setMagazineDeleteError(error.message);
      deletingRef.current = false;
      setMagazineDeleting(false);
    }
  }, [applyCatalogPayload, closeMagazineArticle, magazineActiveArticle?.id]);

  const saveMagazinePreference = useCallback(async (option) => {
    if (!magazineActiveArticle?.id || !option?.id) return;
    setMagazinePreferenceSavingId(option.id);
    try {
      const payload = await saveMagazinePreferenceRequest({
        articleId: magazineActiveArticle.id,
        optionId: option.id,
      });
      setMagazinePreferenceStore(payload);
      setMagazinePreferenceNoticeFading(false);
      setMagazinePreferenceNotice(payload.message || "앞으로의 기사 편집에 반영하도록 하겠습니다");
    } catch (error) {
      console.warn("Magazine preference save failed", error);
      setMagazinePreferenceNoticeFading(false);
      setMagazinePreferenceNotice("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setMagazinePreferenceSavingId("");
    }
  }, [magazineActiveArticle]);

  const submitMagazineComment = useCallback(async (event) => {
    event.preventDefault();
    const text = magazineCommentDraft.trim();
    if (!magazineActiveArticle?.id || !text || submittingRef.current) return;
    const createdAt = new Date().toISOString();
    const tempId = `temp-${Date.now()}`;
    const pendingComment = normalizeComment({
      id: tempId,
      author: "사용자",
      text,
      createdAt,
      reply: {
        id: `reply-${tempId}`,
        author: "매거진 편집자 AI",
        text: "",
        status: "waiting",
        createdAt,
      },
    });
    setMagazineCommentDraft("");
    setMagazineCommentError("");
    submittingRef.current = true;
    setMagazineCommentSubmitting(true);
    setMagazineCommentStore((current) => {
      const normalized = normalizeCommentStore(current, magazineActiveArticle.id);
      return {
        ...normalized,
        updatedAt: createdAt,
        commentCount: normalized.comments.length + 1,
        comments: [...normalized.comments, pendingComment].filter(Boolean),
      };
    });
    window.setTimeout(() => {
      setMagazineCommentStore((current) => {
        const normalized = normalizeCommentStore(current, magazineActiveArticle.id);
        return {
          ...normalized,
          comments: normalized.comments.map((comment) =>
            comment.id === tempId && comment.reply?.status === "waiting"
              ? { ...comment, reply: { ...comment.reply, status: "generating" } }
              : comment
          ),
        };
      });
    }, 700);

    try {
      const runtime = getWritingRuntime();
      const payload = await submitMagazineCommentRequest({
        articleId: magazineActiveArticle.id,
        text,
        provider: runtime.provider,
        model: runtime.selectedModelGroup?.slug,
        reasoning: runtime.selectedReasoning?.id,
        speed: runtime.selectedSpeed?.id,
        approval: runtime.selectedApproval?.id,
      });
      setMagazineCommentStore(normalizeCommentStore(payload, magazineActiveArticle.id));
    } catch (error) {
      setMagazineCommentError(error.message);
      setMagazineCommentStore((current) => {
        const normalized = normalizeCommentStore(current, magazineActiveArticle.id);
        return {
          ...normalized,
          comments: normalized.comments.map((comment) =>
            comment.id === tempId
              ? {
                  ...comment,
                  reply: {
                    id: `reply-${tempId}`,
                    author: "매거진 편집자 AI",
                    text: `답변 생성에 실패했습니다. (${error.message})`,
                    status: "error",
                    createdAt: new Date().toISOString(),
                  },
                }
              : comment
          ),
        };
      });
    } finally {
      submittingRef.current = false;
      setMagazineCommentSubmitting(false);
    }
  }, [getWritingRuntime, magazineActiveArticle, magazineCommentDraft, normalizeComment, normalizeCommentStore]);

  useEffect(() => {
    if (activeView !== "magazine") return undefined;
    const controller = new AbortController();
    void fetchMagazinePreferences({ signal: controller.signal })
      .then(setMagazinePreferenceStore)
      .catch((error) => {
        if (error.name !== "AbortError") console.warn("Magazine preferences load failed", error);
      });
    return () => controller.abort();
  }, [activeView]);

  useEffect(() => {
    if (!magazineActiveArticle?.id) return undefined;
    const controller = new AbortController();
    void fetchMagazineComments({ articleId: magazineActiveArticle.id, signal: controller.signal })
      .then((payload) => setMagazineCommentStore(normalizeCommentStore(payload, magazineActiveArticle.id)))
      .catch((error) => {
        if (error.name !== "AbortError") {
          console.warn("Magazine comments load failed", error);
          setMagazineCommentError(error.message);
        }
      });
    return () => controller.abort();
  }, [magazineActiveArticle?.id, normalizeCommentStore]);

  useEffect(() => {
    if (!magazinePreferenceNotice) return undefined;
    setMagazinePreferenceNoticeFading(false);
    const fadeTimeoutId = window.setTimeout(() => setMagazinePreferenceNoticeFading(true), 2000);
    const clearTimeoutId = window.setTimeout(() => {
      setMagazinePreferenceNotice("");
      setMagazinePreferenceNoticeFading(false);
    }, 2800);
    return () => {
      window.clearTimeout(fadeTimeoutId);
      window.clearTimeout(clearTimeoutId);
    };
  }, [magazinePreferenceNotice]);

  useEffect(() => {
    if (activeView !== "magazine") {
      setMagazineActiveArticle(null);
      setMagazineActiveTopic("");
    }
  }, [activeView]);

  useEffect(() => {
    if (magazineActiveTopic && !topicCatalog.some((topic) => topic.label === magazineActiveTopic)) {
      setMagazineActiveTopic("");
    }
  }, [magazineActiveTopic, topicCatalog]);

  useEffect(() => {
    if (activeView !== "magazine" || (!magazineActiveArticle && !magazineActiveTopic)) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (magazineDeleteDialogOpen) closeMagazineDeleteDialog();
      else if (magazineActiveArticle) closeMagazineArticle();
      else closeMagazineTopic();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeView, closeMagazineArticle, closeMagazineDeleteDialog, closeMagazineTopic, magazineActiveArticle, magazineActiveTopic, magazineDeleteDialogOpen]);

  const selectedMagazinePreferenceIds = magazineActiveArticle?.id
    ? (magazinePreferenceStore?.activeByArticle?.[magazineActiveArticle.id] || [])
        .map((item) => item?.optionId)
        .filter(Boolean)
    : [];
  const magazineComments = Array.isArray(magazineCommentStore?.comments)
    ? magazineCommentStore.comments
    : [];

  return {
    magazineActiveArticle,
    magazineActiveTopic,
    magazinePreferenceSavingId,
    magazinePreferenceNotice,
    magazinePreferenceNoticeFading,
    magazineCommentDraft,
    setMagazineCommentDraft,
    magazineCommentSubmitting,
    magazineCommentError,
    magazineDeleteDialogOpen,
    magazineDeleting,
    magazineDeleteError,
    magazineCopyStatus,
    magazineCopyError,
    selectedMagazinePreferenceIds,
    magazineComments,
    magazineCanvasRef,
    magazineTopicModalRef,
    magazineReaderArticleRef,
    openMagazineTopic,
    closeMagazineTopic,
    openMagazineArticle,
    closeMagazineArticle,
    openMagazineDeleteDialog,
    closeMagazineDeleteDialog,
    copyMagazineArticle,
    confirmMagazineArticleDelete,
    saveMagazinePreference,
    submitMagazineComment,
  };
}
