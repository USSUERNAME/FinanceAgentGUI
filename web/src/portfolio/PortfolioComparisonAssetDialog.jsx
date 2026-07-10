import React, { useEffect, useMemo, useState } from "react";

function cleanComparisonSymbol(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

function comparisonAssetFromRow(row = {}) {
  const symbol = cleanComparisonSymbol(row?.symbol || row?.ticker || row?.code);
  if (!symbol) return null;
  return {
    symbol,
    name: String(row?.name || row?.label || symbol).trim().slice(0, 180),
    englishName: String(row?.englishName || row?.english_name || "").trim().slice(0, 180),
    market: String(row?.market || row?.exchange || "").trim().slice(0, 60),
  };
}

function comparisonAssetRowsFromPayload(payload = {}) {
  const source = Array.isArray(payload?.result)
    ? payload.result
    : Array.isArray(payload?.result?.stocks)
      ? payload.result.stocks
      : Array.isArray(payload)
        ? payload
        : [];
  const seen = new Set();
  return source.flatMap((row) => {
    const asset = comparisonAssetFromRow(row);
    if (!asset || seen.has(asset.symbol)) return [];
    seen.add(asset.symbol);
    return [asset];
  });
}

function comparisonAssetAliases(asset = {}) {
  return [asset.symbol, asset.name, asset.englishName, asset.market]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function resolveComparisonAsset(value, options = []) {
  const raw = String(value || "").trim();
  const symbol = cleanComparisonSymbol(raw);
  const lower = raw.toLocaleLowerCase("ko-KR");
  const exactSymbol = options.find((option) => cleanComparisonSymbol(option.symbol) === symbol);
  if (exactSymbol) return exactSymbol;
  const exactNameMatches = options.filter((option) => (
    comparisonAssetAliases(option).some((alias) => alias.toLocaleLowerCase("ko-KR") === lower)
  ));
  return exactNameMatches.length === 1 ? exactNameMatches[0] : null;
}

async function fetchComparisonAssets(query, signal) {
  const response = await fetch(
    `/api/market-symbols/search?query=${encodeURIComponent(query)}&limit=12`,
    { cache: "no-store", signal }
  );
  const body = await response.json().catch(() => ({}));
  return response.ok && body?.ok !== false ? comparisonAssetRowsFromPayload(body) : [];
}

async function fetchDirectComparisonAsset(symbol, signal) {
  const response = await fetch(`/api/tossinvest/stocks?symbols=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) return null;
  return comparisonAssetRowsFromPayload(body).find((asset) => asset.symbol === symbol) || null;
}

export function PortfolioComparisonAssetDialog({ excludedSymbols = [], onCancel, onSubmit }) {
  const [draft, setDraft] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const excluded = useMemo(
    () => new Set(excludedSymbols.map(cleanComparisonSymbol).filter(Boolean)),
    [excludedSymbols]
  );
  const cleanDraft = String(draft || "").trim();
  const selectedMatchesDraft = Boolean(
    selectedAsset?.symbol && selectedAsset.symbol === cleanComparisonSymbol(cleanDraft)
  );
  const visibleOptions = selectedMatchesDraft
    ? []
    : options.filter((asset) => !excluded.has(asset.symbol)).slice(0, 8);

  useEffect(() => {
    if (!cleanDraft || selectedMatchesDraft) {
      setOptions([]);
      setSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      fetchComparisonAssets(cleanDraft, controller.signal)
        .then((rows) => setOptions(rows))
        .catch((fetchError) => {
          if (fetchError.name !== "AbortError") setOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cleanDraft, selectedMatchesDraft]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !submitting) onCancel?.();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, submitting]);

  async function submitDraft() {
    if (submitting) return;
    if (!cleanDraft) {
      setError("티커 / 종목번호 / 종목명을 입력하세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      let asset = selectedMatchesDraft ? selectedAsset : resolveComparisonAsset(cleanDraft, options);
      if (!asset) {
        const searchRows = await fetchComparisonAssets(cleanDraft);
        asset = resolveComparisonAsset(cleanDraft, searchRows);
      }
      const symbol = cleanComparisonSymbol(asset?.symbol || cleanDraft);
      if (!asset && symbol && /^[A-Z0-9.-]+$/.test(symbol)) {
        asset = await fetchDirectComparisonAsset(symbol);
      }
      if (!asset) {
        setError("KRX/NYSE 목록이나 Toss 종목 조회에서 확인할 수 없는 종목입니다.");
        return;
      }
      if (excluded.has(asset.symbol)) {
        setError("이미 추가된 종목입니다.");
        return;
      }
      onSubmit?.(asset);
    } catch {
      setError("종목을 확인하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="transaction-watchlist-modal-backdrop"
      role="presentation"
      onMouseDown={submitting ? undefined : onCancel}
    >
      <form
        className="transaction-watchlist-modal portfolio-comparison-asset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-comparison-asset-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submitDraft();
        }}
      >
        <label className="transaction-watchlist-field" htmlFor="portfolio-comparison-asset-symbol">
          <span id="portfolio-comparison-asset-dialog-title">티커 / 종목번호 / 종목명을 입력하세요</span>
          <input
            id="portfolio-comparison-asset-symbol"
            type="text"
            value={draft}
            maxLength={32}
            autoFocus
            autoComplete="off"
            disabled={submitting}
            onChange={(event) => {
              setDraft(event.target.value);
              setSelectedAsset(null);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing || !visibleOptions.length) return;
              event.preventDefault();
              const asset = visibleOptions[0];
              setSelectedAsset(asset);
              setDraft(asset.symbol);
              setError("");
            }}
          />
        </label>
        {visibleOptions.length ? (
          <div className="transaction-watchlist-autocomplete" role="listbox" aria-label="종목 자동완성">
            {visibleOptions.map((asset) => (
              <button
                type="button"
                role="option"
                key={`portfolio-comparison-option-${asset.symbol}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSelectedAsset(asset);
                  setDraft(asset.symbol);
                  setError("");
                }}
              >
                <strong>{asset.symbol}</strong>
                <span>{[asset.name, asset.englishName, asset.market].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        ) : cleanDraft && !selectedMatchesDraft ? (
          <p className="transaction-watchlist-autocomplete-empty">
            {searching ? "종목 목록을 검색하는 중입니다." : "검색 결과를 확인하세요."}
          </p>
        ) : null}
        {error ? <p className="transaction-watchlist-modal-error" role="alert">{error}</p> : null}
        <div className="transaction-watchlist-modal-actions">
          <button type="button" disabled={submitting} onClick={onCancel}>
            취소
          </button>
          <button className="is-primary" type="submit" disabled={submitting}>
            {submitting ? "확인 중" : "입력"}
          </button>
        </div>
      </form>
    </div>
  );
}
