import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Settings from "lucide-react/dist/esm/icons/settings.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import { ArticleContextAttachment } from "../arca/ArticleContextAttachment.jsx";
import { ChatAttachmentList, ChatMessage } from "./ChatMessages.jsx";
import { Dropdown, ModelControl } from "./AgentControls.jsx";

export function AgentSidebar({
  addChatAttachmentFiles,
  agentIcon,
  agentOptionsReady,
  agentProvider,
  agentProviderAvailable,
  agentProviderLabel,
  attachedArticle,
  attachmentError,
  chatAttachments,
  codexStatus,
  commandPreview,
  fileInputRef,
  handleComposerDragEnter,
  handleComposerDragLeave,
  handleComposerDragOver,
  handleComposerDrop,
  handleComposerPaste,
  isComposerDragging,
  isSending,
  messageStackRef,
  activeWorldMemoryActionId,
  onClearAttachedArticle,
  onExecuteWorldMemoryAction,
  onNewChat,
  onPromptChange,
  onRemoveChatAttachment,
  onSelectApproval,
  onSelectModel,
  onSelectReasoning,
  onSelectSpeed,
  onStopSend,
  prompt,
  promptHeight,
  promptOverflow,
  promptRef,
  selectedProvider,
  sendPrompt,
  toolbarApprovalOptions,
  toolbarApprovalValue,
  toolbarModelGroups,
  toolbarModelValue,
  toolbarReasoningValue,
  toolbarSpeedValue,
  visibleChatMessages,
  runningWorldMemoryAgentActionId = "",
  worldMemoryActionBusy = false,
}) {
  return (
    <aside className="codex-sidebar">
      <header className="sidebar-header" aria-label="에이전트 controls">
        <div className="sidebar-probe-status" title={commandPreview}>
          <span className={agentProviderAvailable ? "status-dot is-online" : "status-dot"} />
          <span>
            {agentOptionsReady
              ? agentProviderAvailable
                ? `${agentProviderLabel} 연결됨`
                : `${agentProviderLabel} 확인 필요`
              : "에이전트 설정 불러오는 중"}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button tooltip-button"
            type="button"
            aria-label={`새 ${agentProviderLabel} 진단`}
            title="새 채팅"
            data-tooltip="새 채팅"
            onClick={onNewChat}
          >
            <PencilLine size={19} strokeWidth={2.1} />
          </button>
        </div>
      </header>

      <section className="conversation" aria-label="에이전트 conversation">
        {visibleChatMessages.length ? null : (
          <div
            className={
              !agentOptionsReady
                ? "logo-orbit logo-orbit-loading"
                : agentProvider === "antigravity-cli"
                  ? "logo-orbit logo-orbit-antigravity"
                  : "logo-orbit"
            }
            aria-hidden="true"
          >
            {agentOptionsReady ? (
              <img className="agent-logo-image" src={agentIcon} alt="" title={selectedProvider?.detail || codexStatus.label} />
            ) : (
              <LoaderCircle size={26} strokeWidth={2.2} />
            )}
          </div>
        )}

        <div className="message-stack" ref={messageStackRef}>
          {visibleChatMessages.map((message) => (
            <ChatMessage
              message={message}
              agentIcon={agentIcon}
              activeWorldMemoryActionId={activeWorldMemoryActionId}
              runningWorldMemoryAgentActionId={runningWorldMemoryAgentActionId}
              worldMemoryActionBusy={worldMemoryActionBusy}
              onExecuteWorldMemoryAction={onExecuteWorldMemoryAction}
              key={message.id}
            />
          ))}
        </div>
      </section>

      <footer
        className={isComposerDragging ? "composer-shell is-dragging" : "composer-shell"}
        style={{ "--prompt-height": `${promptHeight}px` }}
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
        onPaste={handleComposerPaste}
      >
        {isComposerDragging ? (
          <div className="composer-drop-overlay" aria-hidden="true">
            <Paperclip size={18} strokeWidth={2.2} />
            <span>여기에 놓아서 첨부</span>
          </div>
        ) : null}
        <ArticleContextAttachment article={attachedArticle} onClear={onClearAttachedArticle} agentIcon={agentIcon} />
        <ChatAttachmentList attachments={chatAttachments} onRemove={onRemoveChatAttachment} />
        {attachmentError ? (
          <div className="attachment-error" role="status">
            <AlertTriangle size={14} strokeWidth={2.2} />
            <span>{attachmentError}</span>
          </div>
        ) : null}
        <label className="prompt-label sr-only" htmlFor="codex-prompt">
          무엇이든 물어보세요
        </label>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(event) => {
            void addChatAttachmentFiles(event.target.files);
            event.target.value = "";
          }}
          aria-label="파일 첨부"
        />
        <div className="composer-input-row">
          <textarea
            id="codex-prompt"
            ref={promptRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendPrompt();
              }
            }}
            placeholder={agentOptionsReady ? "무엇이든 물어보세요" : "에이전트 설정을 불러오고 있습니다"}
            rows={1}
            data-scrollable={promptOverflow ? "true" : "false"}
            style={{ height: `${promptHeight}px` }}
            disabled={!agentOptionsReady}
          />
        </div>

        <div className="composer-toolbar">
          <div className="composer-left-tools">
            <button
              className="composer-attach-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!agentOptionsReady || isSending}
              aria-label="파일 또는 이미지 첨부"
              title="파일첨부"
              data-tooltip="파일첨부"
            >
              <Plus size={21} strokeWidth={2.1} />
            </button>
            <Dropdown
              icon={<Settings size={23} strokeWidth={1.9} />}
              value={toolbarApprovalValue}
              options={toolbarApprovalOptions}
              onChange={(nextApproval) => {
                if (agentOptionsReady) onSelectApproval(nextApproval);
              }}
              disabled={!agentOptionsReady}
            />
          </div>

          <div className="toolbar-spacer" />

          <div className="composer-right-tools">
            <button
              className={isSending ? "send-button is-stop" : "send-button"}
              type="button"
              aria-label={isSending ? `${agentProviderLabel} 응답 정지` : `${agentProviderLabel}에 보내기`}
              title={isSending ? "응답 정지" : "보내기"}
              onClick={() => {
                if (isSending) {
                  onStopSend?.();
                  return;
                }
                sendPrompt();
              }}
              disabled={!agentOptionsReady || (!isSending && !prompt.trim() && !chatAttachments.length)}
            >
              {isSending ? (
                <Square size={14} strokeWidth={0} fill="currentColor" />
              ) : (
                <ArrowUp size={22} strokeWidth={2.2} />
              )}
            </button>

            <ModelControl
              modelGroups={toolbarModelGroups}
              model={toolbarModelValue}
              reasoning={toolbarReasoningValue}
              speed={toolbarSpeedValue}
              onModelChange={(nextModel) => {
                if (agentOptionsReady) onSelectModel(nextModel);
              }}
              onReasoningChange={(nextReasoning) => {
                if (agentOptionsReady) onSelectReasoning(nextReasoning);
              }}
              onSpeedChange={(nextSpeed) => {
                if (agentOptionsReady) onSelectSpeed(nextSpeed);
              }}
              disabled={!agentOptionsReady}
            />
          </div>
        </div>
      </footer>
    </aside>
  );
}
