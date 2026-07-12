import React from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle.js";
import CheckCircle2 from "lucide-react/dist/esm/icons/circle-check-big.js";
import Circle from "lucide-react/dist/esm/icons/circle.js";
import Database from "lucide-react/dist/esm/icons/database.js";
import FileText from "lucide-react/dist/esm/icons/file-text.js";
import ImageIcon from "lucide-react/dist/esm/icons/image.js";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.js";
import Play from "lucide-react/dist/esm/icons/play.js";
import Terminal from "lucide-react/dist/esm/icons/terminal.js";
import X from "lucide-react/dist/esm/icons/x.js";
import { ArticleContextAttachment } from "../arca/ArticleContextAttachment.jsx";
import { MarkdownText, renderMarkdownInline } from "../utils/MarkdownText.jsx";
import { formatFileSize } from "../utils/formatters.js";
import { attachmentKind, attachmentLabel } from "./attachments.js";

export function ChatAttachmentList({ attachments = [], onRemove, placement = "composer" }) {
  if (!attachments.length) return null;
  const className = [
    "chat-attachment-strip",
    placement === "message" ? "chat-attachment-strip-message" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} aria-label="첨부 파일">
      {attachments.map((attachment) => {
        const isImage = attachmentKind(attachment) === "image";
        const Icon = isImage ? ImageIcon : FileText;
        return (
          <div
            className={onRemove ? "chat-attachment-card" : "chat-attachment-card is-readonly"}
            key={attachment.id || `${attachment.name}-${attachment.size}`}
          >
            <div className={isImage ? "chat-attachment-thumb is-image" : "chat-attachment-thumb"} aria-hidden="true">
              {isImage && attachment.previewUrl ? (
                <img src={attachment.previewUrl} alt="" />
              ) : (
                <Icon size={16} strokeWidth={2.1} />
              )}
            </div>
            <div className="chat-attachment-copy">
              <strong title={attachmentLabel(attachment)}>{attachmentLabel(attachment)}</strong>
              <span>{formatFileSize(attachment.size)} · {attachment.type || "파일"}</span>
            </div>
            {onRemove ? (
              <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`${attachmentLabel(attachment)} 첨부 제거`}>
                <X size={15} strokeWidth={2.2} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ChatBlock({
  block,
  agentIcon = "",
  activeWorldMemoryActionId = "",
  runningWorldMemoryAgentActionId = "",
  worldMemoryActionBusy = false,
  onExecuteWorldMemoryAction,
}) {
  if (block.type === "status") {
    const Icon =
      block.tone === "error" ? AlertTriangle : block.tone === "done" ? CheckCircle2 : LoaderCircle;
    return (
      <div className={`chat-status chat-status-${block.tone || "working"}`}>
        <Icon size={16} strokeWidth={2.2} />
        <div>
          <strong>{block.title}</strong>
          <p>{block.body}</p>
        </div>
      </div>
    );
  }

  if (block.type === "paragraph") {
    return <MarkdownText text={block.text} />;
  }

  if (block.type === "list") {
    return (
      <div className="chat-section">
        {block.title ? <h2>{block.title}</h2> : null}
        <ul className="chat-list">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.type === "checklist") {
    return (
      <div className="chat-checklist">
        {block.items.map((item) => {
          const Icon = item.done ? CheckCircle2 : Circle;
          return (
            <div className={item.done ? "is-done" : ""} key={item.label}>
              <Icon size={16} strokeWidth={2.1} />
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === "code") {
    return (
      <figure className="chat-code">
        <figcaption>
          <Terminal size={14} strokeWidth={2} />
          <span>{block.language}</span>
        </figcaption>
        <pre>{block.code}</pre>
      </figure>
    );
  }

  if (block.type === "files") {
    return (
      <div className="chat-files">
        {block.items.map((item) => (
          <button type="button" className="chat-file" key={item.path} title={item.path}>
            <FileText size={16} strokeWidth={2} />
            <span>
              <strong>{item.label}</strong>
              <small>{item.path}</small>
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (block.type === "table") {
    return (
      <div className="chat-table-wrap">
        <table className="chat-table">
          <thead>
            <tr>
              {block.columns.map((column, columnIndex) => (
                <th key={`column-${columnIndex}`}>{renderMarkdownInline(column, `block-table-th-${columnIndex}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>
                    {renderMarkdownInline(cell, `block-table-cell-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "evidence") {
    return (
      <div className="chat-evidence">
        <div className="evidence-thumb" aria-hidden="true">
          <img className="agent-logo-image" src={agentIcon} alt="" />
        </div>
        <div>
          <div className="evidence-title">
            <ImageIcon size={15} strokeWidth={2} />
            <strong>{block.title}</strong>
          </div>
          <p>{block.body}</p>
        </div>
      </div>
    );
  }

  if (block.type === "world-memory-action") {
    const action = block.action || {};
    const isActive = Boolean(action.id) && action.id === activeWorldMemoryActionId;
    const isRunning = Boolean(action.id) && action.id === runningWorldMemoryAgentActionId;
    const disabled = !isActive || worldMemoryActionBusy || !onExecuteWorldMemoryAction;
    return (
      <div className={isActive ? "chat-action-card" : "chat-action-card is-inactive"}>
        <div className="chat-action-card-main">
          <Database size={16} strokeWidth={2.2} />
          <div>
            <strong>{action.label || block.title || "월드메모리 변경 제안"}</strong>
            {action.reason ? <p>{action.reason}</p> : null}
          </div>
        </div>
        <div className="chat-action-card-footer">
          <span>{action.action || "world_memory_action"}</span>
          <span>{action.riskLevel || "low"}</span>
          <button type="button" disabled={disabled} onClick={() => onExecuteWorldMemoryAction(action)}>
            {isRunning ? <LoaderCircle className="is-spinning" size={14} strokeWidth={2.2} /> : <Play size={14} strokeWidth={2.2} />}
            <span>{isActive ? "확인 후 실행" : "실행 완료"}</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export function ChatMessage({
  message,
  agentIcon = "",
  activeWorldMemoryActionId = "",
  runningWorldMemoryAgentActionId = "",
  worldMemoryActionBusy = false,
  onExecuteWorldMemoryAction,
}) {
  if (message.role === "user") {
    const hasContext = Boolean(message.article || message.attachments?.length);
    return (
      <article className="chat-message chat-message-user">
        <div className={hasContext ? "user-bubble user-bubble-with-context" : "user-bubble"}>
          {message.article ? <ArticleContextAttachment article={message.article} placement="message" agentIcon={agentIcon} /> : null}
          <ChatAttachmentList attachments={message.attachments || []} placement="message" />
          <p className="user-message-text">{message.text}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="chat-message chat-message-assistant">
      <div className="assistant-avatar" aria-hidden="true">
        <img className="agent-logo-image" src={agentIcon} alt="" />
      </div>
      <div className="assistant-response">
        <div className="response-meta">
          <span>{message.providerLabel || "Codex CLI"}</span>
          <span>{message.time}</span>
        </div>
        <div className="response-blocks">
          {message.blocks.map((block, index) => (
            <ChatBlock
              block={block}
              agentIcon={agentIcon}
              activeWorldMemoryActionId={activeWorldMemoryActionId}
              runningWorldMemoryAgentActionId={runningWorldMemoryAgentActionId}
              worldMemoryActionBusy={worldMemoryActionBusy}
              onExecuteWorldMemoryAction={onExecuteWorldMemoryAction}
              key={`${block.type}-${index}`}
            />
          ))}
        </div>
      </div>
    </article>
  );
}
