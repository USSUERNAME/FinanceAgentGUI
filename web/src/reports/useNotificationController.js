import { useCallback, useEffect, useState } from "react";
import {
  fetchNotificationStatus,
  markReportsNotificationsOpened as markReportsOpenedRequest,
} from "./notificationApi.js";

const NOTIFICATION_STATUS_POLL_INTERVAL_MS = 15_000;

export function useNotificationController() {
  const [notificationStatus, setNotificationStatus] = useState(null);

  const refreshNotificationStatus = useCallback(async () => {
    const payload = await fetchNotificationStatus();
    setNotificationStatus(payload);
    return payload;
  }, []);

  const markReportsNotificationsOpened = useCallback(async () => {
    try {
      const payload = await markReportsOpenedRequest();
      setNotificationStatus(payload);
      return payload;
    } catch {
      // The notification badge will be reconciled by the next status poll.
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function pollNotificationStatus() {
      try {
        const payload = await fetchNotificationStatus();
        if (!cancelled) setNotificationStatus(payload);
      } catch {
        // Keep the last known badge state; polling should not disturb the workspace.
      }
    }
    void pollNotificationStatus();
    const timer = window.setInterval(pollNotificationStatus, NOTIFICATION_STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return {
    notificationStatus,
    refreshNotificationStatus,
    markReportsNotificationsOpened,
  };
}
