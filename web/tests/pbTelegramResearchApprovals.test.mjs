import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createPbTelegramResearchApprovalService,
} from "../server/pbTelegramResearchApprovals.mjs";

const tempRoot = join(process.cwd(), "data", ".test-telegram-research-approvals");
const attachmentKey = "a".repeat(64);

function snapshot() {
  return {
    telegramSources: {
      pdfAttachments: [
        {
          attachmentKey,
          filename: "20260730_global_strategy.pdf",
          mimeType: "application/pdf",
          size: 4096,
          channelUsername: "HanaResearch",
          channelName: "하나증권 리서치",
          messageId: 1234,
          postUrl: "https://t.me/HanaResearch/1234",
          publishedAt: "2026-07-30T01:00:00Z",
          title: "글로벌 전략 리포트",
        },
      ],
    },
  };
}

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("Telegram PDF approval service exposes discovered attachments as pending", async () => {
  const service = createPbTelegramResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    loadSnapshot: async () => snapshot(),
  });

  const state = await service.status();
  assert.deepEqual(state.counts, {
    total: 1,
    pending: 1,
    approved: 0,
    excluded: 0,
  });
  assert.equal(state.items[0].attachmentKey, attachmentKey);
  assert.equal(state.items[0].filename, "20260730_global_strategy.pdf");
  assert.equal(state.items[0].channelUsername, "HanaResearch");
  assert.equal(state.items[0].state, "pending");
});

test("Telegram PDF approval service persists and replaces an explicit decision", async () => {
  const service = createPbTelegramResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    now: () => "2026-07-30T02:00:00Z",
    loadSnapshot: async () => snapshot(),
  });

  let state = await service.decide({
    attachmentKey,
    decision: "approved",
  });
  assert.equal(state.items[0].state, "approved");

  state = await service.decide({
    attachmentKey,
    decision: "excluded",
  });
  assert.equal(state.items[0].state, "excluded");

  const registry = JSON.parse(await readFile(
    join(
      tempRoot,
      "workspace",
      "telegram_research_approvals",
      "attachments.json",
    ),
    "utf8",
  ));
  assert.equal(
    registry.schema_version,
    "telegram_research_attachment_approvals.v1",
  );
  assert.deepEqual(registry.decisions, [
    {
      attachment_key: attachmentKey,
      filename: "20260730_global_strategy.pdf",
      channel_username: "HanaResearch",
      decision: "excluded",
      decided_at: "2026-07-30T02:00:00Z",
    },
  ]);
});

test("Telegram PDF approval service rejects unknown attachments", async () => {
  const service = createPbTelegramResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    loadSnapshot: async () => snapshot(),
  });

  await assert.rejects(
    service.decide({ attachmentKey: "unknown", decision: "approved" }),
    /찾지 못했습니다/,
  );
});
