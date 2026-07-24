import { useCallback, useEffect, useState } from "react";
import { fetchDailyIntelligence } from "./dailyIntelligenceApi.js";

export function useDailyIntelligenceController() {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await fetchDailyIntelligence());
    } catch (requestError) {
      setError(requestError.message || "Daily Intelligence를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    snapshot,
    busy,
    error,
    reload,
  };
}
