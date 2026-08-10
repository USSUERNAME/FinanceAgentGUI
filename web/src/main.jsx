import React, { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { shouldDisplayRuntimeError } from "./runtimeErrorPolicy.js";
import "./styles.css";

class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("FinanceAgentGUI render failure", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error?.stack || this.state.error?.message || String(this.state.error);

    return (
      <main className="app-runtime-failure">
        <section>
          <p className="runtime-eyebrow">런타임 오류</p>
          <h1>화면 렌더링이 중단되었습니다.</h1>
          <p>
            앱은 아직 실행 중입니다. 아래 오류를 확인한 뒤 다시 불러오면 현재 서버 상태로 화면을 복구합니다.
          </p>
          <pre>{message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            다시 불러오기
          </button>
        </section>
      </main>
    );
  }
}

function showGlobalRuntimeError(error) {
  const message = error?.stack || error?.message || String(error);
  let overlay = document.getElementById("runtime-error-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "runtime-error-overlay";
    overlay.className = "runtime-error-overlay";
    const title = document.createElement("strong");
    title.textContent = "런타임 오류";
    const body = document.createElement("pre");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "다시 불러오기";
    button.addEventListener("click", () => window.location.reload());
    overlay.append(title, body, button);
    document.body.appendChild(overlay);
  }
  overlay.querySelector("pre").textContent = message;
}

window.addEventListener("error", (event) => {
  const error = event.error || event.message;
  if (shouldDisplayRuntimeError(error, event.filename)) showGlobalRuntimeError(error);
});
window.addEventListener("unhandledrejection", (event) => {
  if (shouldDisplayRuntimeError(event.reason)) showGlobalRuntimeError(event.reason);
});

const app = (
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

// StrictMode intentionally replays mount effects in development. This app's mount
// effects call local APIs and external services, so keep the replay opt-in for
// diagnostics instead of doubling every reload by default.
createRoot(document.getElementById("root")).render(
  import.meta.env.DEV && import.meta.env.VITE_REACT_STRICT_MODE === "1"
    ? <StrictMode>{app}</StrictMode>
    : app
);
