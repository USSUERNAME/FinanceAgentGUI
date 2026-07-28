import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createPbGmailResearchApprovalService,
} from "../server/pbGmailResearchApprovals.mjs";

const tempRoot = join(process.cwd(), "data", ".test-gmail-research-approvals");

function snapshot({ completed = false } = {}) {
  return {
    gmailResearch: {
      candidates: [
        {
          publisher: "Example Research",
          title: "Weekly outlook",
          publishedAt: "2026-07-29T01:00:00Z",
          sourceReference: "gmail:message-1",
          ...(completed ? {
            analyzedAttachments: [{
              attachmentKey: "attachment-key-1",
              filename: "weekly-outlook.pdf",
              analysisState: "analyzed",
            }],
          } : {}),
          attachments: [
            {
              attachmentKey: "attachment-key-1",
              filename: "weekly-outlook.pdf",
              mimeType: "application/pdf",
              size: 2048,
              isPdf: true,
            },
            {
              attachmentKey: "attachment-key-2",
              filename: "chart.png",
              mimeType: "image/png",
              size: 512,
              isPdf: false,
            },
          ],
        },
      ],
    },
  };
}

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("Gmail attachment approval service exposes only PDF attachments", async () => {
  const service = createPbGmailResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    loadSnapshot: async () => snapshot(),
  });

  const state = await service.status();
  assert.deepEqual(state.counts, {
    total: 1,
    pending: 1,
    approved: 0,
    excluded: 0,
    ready: 0,
  });
  assert.equal(state.items[0].filename, "weekly-outlook.pdf");
  assert.equal(state.items[0].state, "pending");
});

test("Gmail attachment approval service persists an explicit decision", async () => {
  const service = createPbGmailResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    now: () => "2026-07-29T02:00:00Z",
    loadSnapshot: async () => snapshot(),
  });

  const state = await service.decide({
    attachmentKey: "attachment-key-1",
    decision: "approved",
  });
  assert.equal(state.items[0].state, "approved");

  const registry = JSON.parse(await readFile(
    join(
      tempRoot,
      "workspace",
      "gmail_research_approvals",
      "attachments.json",
    ),
    "utf8",
  ));
  assert.equal(registry.schema_version, "gmail_research_attachment_approvals.v1");
  assert.deepEqual(registry.decisions, [
    {
      attachment_key: "attachment-key-1",
      filename: "weekly-outlook.pdf",
      decision: "approved",
      decided_at: "2026-07-29T02:00:00Z",
    },
  ]);
});

test("Gmail attachment approval service marks analyzed PDFs ready", async () => {
  const service = createPbGmailResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    loadSnapshot: async () => snapshot({ completed: true }),
  });

  const state = await service.status();
  assert.deepEqual(state.counts, {
    total: 1,
    pending: 0,
    approved: 0,
    excluded: 0,
    ready: 1,
  });
  assert.equal(state.items[0].state, "ready");
});

test("Gmail attachment approval service rejects unknown attachments", async () => {
  const service = createPbGmailResearchApprovalService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: tempRoot },
    loadSnapshot: async () => snapshot(),
  });

  await assert.rejects(
    service.decide({ attachmentKey: "unknown", decision: "approved" }),
    /찾지 못했습니다/,
  );
});
