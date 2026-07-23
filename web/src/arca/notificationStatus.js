import { formatCount } from "../utils/formatters.js";

export function arcaNotificationHealthState(status) {
  const count = Math.max(0, Number(status?.count || 0));
  const connected = Boolean(status?.connected);
  const hasError = status?.status === "error" || status?.ok === false;

  if (hasError) {
    return {
      level: "error",
      sidebarLevel: "error",
      count: 0,
      showNotificationCount: false,
      showSidebarDot: true,
      title: status?.error ? `아카라이브 알림 조회 불가: ${status.error}` : "아카라이브 알림 조회 불가",
      ariaLabel: "아카라이브 알림 조회 불가",
    };
  }

  if (!connected) {
    return {
      level: "idle",
      sidebarLevel: "online",
      count: 0,
      showNotificationCount: false,
      showSidebarDot: true,
      title: status?.error || "아카라이브 알림 로그인 필요",
      ariaLabel: "아카라이브 알림 로그인 필요",
    };
  }

  if (count > 0) {
    return {
      level: "online",
      sidebarLevel: "online",
      count,
      showNotificationCount: true,
      showSidebarDot: true,
      title: `아카라이브 알림 ${formatCount(count)}개`,
      ariaLabel: `아카라이브 알림 ${formatCount(count)}개`,
    };
  }

  return {
    level: "idle",
    sidebarLevel: "online",
    count: 0,
    showNotificationCount: true,
    showSidebarDot: true,
    title: "아카라이브 알림 없음",
    ariaLabel: "아카라이브 알림 없음",
  };
}
