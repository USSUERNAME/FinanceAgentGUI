import { useState } from "react";

export function useTransactionWatchlistState() {
  const [selectedWatchlistChartSymbol, setSelectedWatchlistChartSymbol] = useState("");
  const [watchlistCreateOpen, setWatchlistCreateOpen] = useState(false);
  const [watchlistGroupNameDraft, setWatchlistGroupNameDraft] = useState("");
  const [watchlistGroupNameError, setWatchlistGroupNameError] = useState("");
  const [watchlistDeleteTarget, setWatchlistDeleteTarget] = useState(null);
  const [watchlistOrderEditing, setWatchlistOrderEditing] = useState(false);
  const [watchlistOrderDraft, setWatchlistOrderDraft] = useState([]);
  const [selectedWatchlistGroupId, setSelectedWatchlistGroupId] = useState("");
  const [watchlistRenameGroupId, setWatchlistRenameGroupId] = useState("");
  const [watchlistRenamePlacement, setWatchlistRenamePlacement] = useState("sidebar");
  const [watchlistRenameDraft, setWatchlistRenameDraft] = useState("");
  const [watchlistRenameError, setWatchlistRenameError] = useState("");
  const [watchlistSymbolOrderEditing, setWatchlistSymbolOrderEditing] = useState(false);
  const [watchlistSymbolOrderDraft, setWatchlistSymbolOrderDraft] = useState([]);
  const [watchlistSymbolAddOpen, setWatchlistSymbolAddOpen] = useState(false);
  const [watchlistSymbolDraft, setWatchlistSymbolDraft] = useState("");
  const [watchlistSelectedSymbol, setWatchlistSelectedSymbol] = useState(null);
  const [watchlistSymbolError, setWatchlistSymbolError] = useState("");
  const [watchlistSavedSymbolOptions, setWatchlistSavedSymbolOptions] = useState([]);
  const [watchlistRemoteSymbolOptions, setWatchlistRemoteSymbolOptions] = useState([]);

  return {
    selectedWatchlistChartSymbol, setSelectedWatchlistChartSymbol,
    watchlistCreateOpen, setWatchlistCreateOpen,
    watchlistGroupNameDraft, setWatchlistGroupNameDraft,
    watchlistGroupNameError, setWatchlistGroupNameError,
    watchlistDeleteTarget, setWatchlistDeleteTarget,
    watchlistOrderEditing, setWatchlistOrderEditing,
    watchlistOrderDraft, setWatchlistOrderDraft,
    selectedWatchlistGroupId, setSelectedWatchlistGroupId,
    watchlistRenameGroupId, setWatchlistRenameGroupId,
    watchlistRenamePlacement, setWatchlistRenamePlacement,
    watchlistRenameDraft, setWatchlistRenameDraft,
    watchlistRenameError, setWatchlistRenameError,
    watchlistSymbolOrderEditing, setWatchlistSymbolOrderEditing,
    watchlistSymbolOrderDraft, setWatchlistSymbolOrderDraft,
    watchlistSymbolAddOpen, setWatchlistSymbolAddOpen,
    watchlistSymbolDraft, setWatchlistSymbolDraft,
    watchlistSelectedSymbol, setWatchlistSelectedSymbol,
    watchlistSymbolError, setWatchlistSymbolError,
    watchlistSavedSymbolOptions, setWatchlistSavedSymbolOptions,
    watchlistRemoteSymbolOptions, setWatchlistRemoteSymbolOptions,
  };
}
