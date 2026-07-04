import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.js";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.js";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Settings from "lucide-react/dist/esm/icons/settings.js";
import Square from "lucide-react/dist/esm/icons/square.js";
import { ArticleContextAttachment } from "../arca/ArticleContextAttachment.jsx";
import { ChatAttachmentList, ChatMessage } from "./ChatMessages.jsx";
import { Dropdown, ModelControl } from "./AgentControls.jsx";

export function ChatCanvas({
  activeWorldMemoryActionId,
  addChatAttachmentFiles,
  agentIcon,
  agentOptionsReady,
  agentProviderLabel,
  attachedArticle,
  attachmentError,
  chatAttachments,
  fileInputRef,
  handleComposerDragEnter,
  handleComposerDragLeave,
  handleComposerDragOver,
  handleComposerDrop,
  handleComposerPaste,
  isComposerDragging,
  isSending,
  messageStackRef,
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
  const hasMessages = visibleChatMessages.length > 0;
  const composer = (
    <footer
      className={isComposerDragging ? "chat-page-composer is-dragging" : "chat-page-composer"}
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
      <label className="prompt-label sr-only" htmlFor="chat-page-prompt">
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
      <textarea
        id="chat-page-prompt"
        ref={promptRef}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendPrompt();
          }
        }}
        placeholder="무엇이든 물어보세요"
        rows={1}
        data-scrollable={promptOverflow ? "true" : "false"}
        style={{ height: `${promptHeight}px` }}
        disabled={!agentOptionsReady}
      />

      <div className="chat-page-toolbar">
        <div className="chat-page-left-tools">
          <button
            className="chat-page-attach-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!agentOptionsReady || isSending}
            aria-label="파일 또는 이미지 첨부"
            title="파일첨부"
          >
            <Plus size={24} strokeWidth={2.1} />
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

        <div className="chat-page-right-tools">
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
          <button
            className={isSending ? "chat-page-send-button is-stop" : "chat-page-send-button"}
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
              <Square size={15} strokeWidth={0} fill="currentColor" />
            ) : (
              <ArrowUp size={19} strokeWidth={2.1} />
            )}
          </button>
        </div>
      </div>
    </footer>
  );

  return (
    <section
      className={hasMessages ? "workspace-canvas chat-canvas is-started" : "workspace-canvas chat-canvas"}
      aria-label="채팅"
    >
      {hasMessages ? (
        <button className="chat-page-new-chat-button" type="button" onClick={onNewChat}>
          <PencilLine size={16} strokeWidth={2.1} />
          <span>새 채팅</span>
        </button>
      ) : null}
      {hasMessages ? (
        <>
          <div className="chat-page-message-stack" ref={messageStackRef}>
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
          {composer}
        </>
      ) : (
        <div className="chat-page-idle-stack">
          <div className="chat-page-agent-icon" aria-hidden="true">
            <img className="agent-logo-image" src={agentIcon} alt="" />
          </div>
          <div className="chat-page-message-spacer" ref={messageStackRef} aria-hidden="true" />
          {composer}
        </div>
      )}
    </section>
  );
}
