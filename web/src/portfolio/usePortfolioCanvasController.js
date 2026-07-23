import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cleanPortfolioWidgetText } from "./widgetIdentity.js";
import {
  buildPortfolioCanvasCreateState,
  buildPortfolioCanvasDeleteState,
  buildPortfolioCanvasDuplicateState,
  buildPortfolioCanvasRenameState,
  buildPortfolioCanvasSelectState,
  buildPortfolioCanvasWorkspaceUpdateState,
} from "./canvasStoreActions.js";
import { loadPortfolioCanvasStoreFile, savePortfolioCanvasStoreFile } from "./canvasStoreApi.js";
import {
  normalizePortfolioCanvasStore,
  normalizePortfolioChatMessages,
  portfolioCanvasStoreHasCanvases,
  readStoredPortfolioCanvasStore,
  writeStoredPortfolioCanvasStore,
} from "./workspaceState.js";

const PORTFOLIO_CANVAS_FILE_SAVE_DEBOUNCE_MS = 450;

export function usePortfolioCanvasController({
  setActiveView,
  setPortfolioContext,
  defaultMode = "asset",
}) {
  const [portfolioCanvasStore, setPortfolioCanvasStore] = useState(() => readStoredPortfolioCanvasStore());
  const [portfolioSidebarOpen, setPortfolioSidebarOpen] = useState(false);
  const [portfolioCanvasMenuId, setPortfolioCanvasMenuId] = useState("");
  const [editingPortfolioCanvasId, setEditingPortfolioCanvasId] = useState("");
  const [portfolioCanvasNameDraft, setPortfolioCanvasNameDraft] = useState("");
  const [pendingDeletePortfolioCanvas, setPendingDeletePortfolioCanvas] = useState(null);
  const portfolioCanvasNameInputRef = useRef(null);
  const portfolioCanvasStoreRef = useRef(portfolioCanvasStore);
  const portfolioCanvasFileReadyRef = useRef(false);
  const portfolioCanvasFileSignatureRef = useRef("");

  const portfolioCanvases = portfolioCanvasStore.canvases;
  const activePortfolioCanvas = useMemo(
    () => portfolioCanvases.find((canvas) => canvas.id === portfolioCanvasStore.activeCanvasId) || null,
    [portfolioCanvases, portfolioCanvasStore.activeCanvasId],
  );

  const updatePortfolioCanvasStore = useCallback((updater) => {
    setPortfolioCanvasStore((current) => normalizePortfolioCanvasStore(updater(current)));
  }, []);

  const updatePortfolioCanvasWorkspace = useCallback((canvasId, workspace) => {
    const targetCanvasId = String(canvasId || "").trim();
    if (!targetCanvasId) return;
    setPortfolioCanvasStore((current) =>
      buildPortfolioCanvasWorkspaceUpdateState(current, workspace, targetCanvasId)
    );
  }, []);

  const updateActivePortfolioCanvasWorkspace = useCallback((workspace) => {
    if (!activePortfolioCanvas?.id) return;
    updatePortfolioCanvasWorkspace(activePortfolioCanvas.id, workspace);
  }, [activePortfolioCanvas?.id, updatePortfolioCanvasWorkspace]);

  const updatePortfolioCanvasChatMessages = useCallback((canvasId, updater) => {
    const targetCanvasId = String(canvasId || "").trim();
    if (!targetCanvasId) return;
    setPortfolioCanvasStore((current) => ({
      ...current,
      canvases: current.canvases.map((canvas) => {
        if (canvas.id !== targetCanvasId) return canvas;
        const currentMessages = normalizePortfolioChatMessages(canvas.chatMessages);
        const nextMessages = typeof updater === "function" ? updater(currentMessages) : updater;
        return {
          ...canvas,
          chatMessages: normalizePortfolioChatMessages(nextMessages),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }, []);

  const createPortfolioCanvasFromGuide = useCallback((mode = defaultMode) => {
    let createdCanvasId = "";
    updatePortfolioCanvasStore((current) => {
      const result = buildPortfolioCanvasCreateState(current, mode);
      createdCanvasId = result.canvasId;
      return result.store;
    });
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setPortfolioContext(null);
    setActiveView("portfolio-canvas");
    return createdCanvasId;
  }, [defaultMode, setActiveView, setPortfolioContext, updatePortfolioCanvasStore]);

  const selectPortfolioCanvas = useCallback((canvasId) => {
    updatePortfolioCanvasStore((current) => buildPortfolioCanvasSelectState(current, canvasId));
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setPortfolioContext(null);
    setActiveView("portfolio-canvas");
  }, [setActiveView, setPortfolioContext, updatePortfolioCanvasStore]);

  const renamePortfolioCanvasTo = useCallback((canvasId, nextName) => {
    updatePortfolioCanvasStore((current) => buildPortfolioCanvasRenameState(current, canvasId, nextName).store);
  }, [updatePortfolioCanvasStore]);

  const startPortfolioCanvasRename = useCallback((canvas) => {
    if (!canvas) return;
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setEditingPortfolioCanvasId(canvas.id);
    setPortfolioCanvasNameDraft(canvas.name || "");
  }, []);

  const closePortfolioCanvasRename = useCallback(() => {
    setEditingPortfolioCanvasId("");
    setPortfolioCanvasNameDraft("");
  }, []);

  const savePortfolioCanvasNameDraft = useCallback(() => {
    if (!editingPortfolioCanvasId) return;
    const currentCanvas = portfolioCanvases.find((canvas) => canvas.id === editingPortfolioCanvasId);
    const cleanName = cleanPortfolioWidgetText(portfolioCanvasNameDraft, 80);
    if (currentCanvas && cleanName && cleanName !== currentCanvas.name) {
      renamePortfolioCanvasTo(currentCanvas.id, cleanName);
    }
    closePortfolioCanvasRename();
  }, [
    closePortfolioCanvasRename,
    editingPortfolioCanvasId,
    portfolioCanvasNameDraft,
    portfolioCanvases,
    renamePortfolioCanvasTo,
  ]);

  const handlePortfolioCanvasNameKeyDown = useCallback((event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      savePortfolioCanvasNameDraft();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.dataset.cancelled = "true";
      closePortfolioCanvasRename();
    }
  }, [closePortfolioCanvasRename, savePortfolioCanvasNameDraft]);

  const duplicatePortfolioCanvas = useCallback((canvas) => {
    if (!canvas) return "";
    let duplicatedCanvasId = "";
    updatePortfolioCanvasStore((current) => {
      const result = buildPortfolioCanvasDuplicateState(current, canvas);
      duplicatedCanvasId = result.canvasId;
      return result.store;
    });
    setPortfolioSidebarOpen(true);
    setPortfolioCanvasMenuId("");
    setPortfolioContext(null);
    setActiveView("portfolio-canvas");
    return duplicatedCanvasId;
  }, [setActiveView, setPortfolioContext, updatePortfolioCanvasStore]);

  const requestDeletePortfolioCanvas = useCallback((canvas) => {
    setPendingDeletePortfolioCanvas(canvas || null);
    setPortfolioCanvasMenuId("");
  }, []);

  const cancelDeletePortfolioCanvas = useCallback(() => {
    setPendingDeletePortfolioCanvas(null);
  }, []);

  const confirmDeletePortfolioCanvas = useCallback(() => {
    const targetId = pendingDeletePortfolioCanvas?.id;
    if (!targetId) return;
    const visibleDeleteState = buildPortfolioCanvasDeleteState(portfolioCanvasStore, targetId);
    setPortfolioCanvasStore((current) => buildPortfolioCanvasDeleteState(current, targetId).store);
    if (visibleDeleteState.deletedActive) {
      setPortfolioContext(null);
      setActiveView(visibleDeleteState.nextActiveCanvasId ? "portfolio-canvas" : "portfolio");
    }
    if (editingPortfolioCanvasId === targetId) closePortfolioCanvasRename();
    setPendingDeletePortfolioCanvas(null);
  }, [
    closePortfolioCanvasRename,
    editingPortfolioCanvasId,
    pendingDeletePortfolioCanvas?.id,
    portfolioCanvasStore,
    setActiveView,
    setPortfolioContext,
  ]);

  useEffect(() => {
    if (!editingPortfolioCanvasId) return;
    portfolioCanvasNameInputRef.current?.focus();
    portfolioCanvasNameInputRef.current?.select();
  }, [editingPortfolioCanvasId]);

  useEffect(() => {
    portfolioCanvasStoreRef.current = portfolioCanvasStore;
    writeStoredPortfolioCanvasStore(portfolioCanvasStore);
  }, [portfolioCanvasStore]);

  useEffect(() => {
    let cancelled = false;
    const browserStoreAtBoot = readStoredPortfolioCanvasStore();
    async function hydratePortfolioCanvasStore() {
      try {
        const payload = await loadPortfolioCanvasStoreFile();
        if (cancelled) return;
        const fileStore = normalizePortfolioCanvasStore(payload.store);
        const currentStore = normalizePortfolioCanvasStore(portfolioCanvasStoreRef.current);
        const userChangedBeforeHydration =
          portfolioCanvasStoreHasCanvases(currentStore) &&
          JSON.stringify(currentStore) !== JSON.stringify(normalizePortfolioCanvasStore(browserStoreAtBoot));
        const browserStore = portfolioCanvasStoreHasCanvases(currentStore) ? currentStore : browserStoreAtBoot;
        const nextStore =
          userChangedBeforeHydration || !portfolioCanvasStoreHasCanvases(fileStore) ? browserStore : fileStore;
        if (portfolioCanvasStoreHasCanvases(nextStore) || portfolioCanvasStoreHasCanvases(fileStore)) {
          portfolioCanvasFileSignatureRef.current = JSON.stringify(normalizePortfolioCanvasStore(nextStore));
          setPortfolioCanvasStore(normalizePortfolioCanvasStore(nextStore));
          writeStoredPortfolioCanvasStore(nextStore);
        }
        portfolioCanvasFileReadyRef.current = true;
        if (
          portfolioCanvasStoreHasCanvases(nextStore) &&
          (userChangedBeforeHydration || !portfolioCanvasStoreHasCanvases(fileStore) || payload.source === "backup")
        ) {
          void savePortfolioCanvasStoreFile(nextStore).catch(() => {});
        }
      } catch {
        if (!cancelled) portfolioCanvasFileReadyRef.current = false;
      }
    }
    void hydratePortfolioCanvasStore();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!portfolioCanvasFileReadyRef.current) return;
    const nextStore = normalizePortfolioCanvasStore(portfolioCanvasStore);
    const nextSignature = JSON.stringify(nextStore);
    if (nextSignature === portfolioCanvasFileSignatureRef.current) return;
    const timer = window.setTimeout(() => {
      portfolioCanvasFileSignatureRef.current = nextSignature;
      void savePortfolioCanvasStoreFile(nextStore).catch(() => {
        if (portfolioCanvasFileSignatureRef.current === nextSignature) {
          portfolioCanvasFileSignatureRef.current = "";
        }
      });
    }, PORTFOLIO_CANVAS_FILE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [portfolioCanvasStore]);

  return {
    portfolioCanvasStore,
    portfolioCanvases,
    activePortfolioCanvas,
    portfolioSidebarOpen, setPortfolioSidebarOpen,
    portfolioCanvasMenuId, setPortfolioCanvasMenuId,
    editingPortfolioCanvasId,
    portfolioCanvasNameDraft, setPortfolioCanvasNameDraft,
    pendingDeletePortfolioCanvas,
    portfolioCanvasNameInputRef,
    updatePortfolioCanvasChatMessages,
    updatePortfolioCanvasWorkspace,
    updateActivePortfolioCanvasWorkspace,
    createPortfolioCanvasFromGuide,
    selectPortfolioCanvas,
    renamePortfolioCanvasTo,
    startPortfolioCanvasRename,
    closePortfolioCanvasRename,
    savePortfolioCanvasNameDraft,
    handlePortfolioCanvasNameKeyDown,
    duplicatePortfolioCanvas,
    requestDeletePortfolioCanvas,
    cancelDeletePortfolioCanvas,
    confirmDeletePortfolioCanvas,
  };
}
