import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createPbGmailSenderReviewService } from "../server/pbGmailSenderReviews.mjs";

const tempRoot = join(process.cwd(), "data", ".test-gmail-sender-reviews");

test.afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function seedReview(engineRoot, overrides = {}) {
  const reviewDir = join(engineRoot, "workspace", "gmail_research_reviews");
  await mkdir(reviewDir, { recursive: true });
  await writeFile(
    join(reviewDir, "blocked_senders.json"),
    JSON.stringify({
      schema_version: "gmail_research_sender_reviews.v1",
      items: [{
        sender_key: "sender-key-1",
        sender_name: "Example Strategy",
        sender_email: "ideas@example.com",
        sender_domain: "example.com",
        latest_subject: "Weekly outlook",
        latest_published_at: "2026-08-07T01:00:00Z",
        reason: "sender_not_allowlisted",
        reviewable: true,
        message_count: 2,
        first_seen_at: "2026-08-06T01:00:00Z",
        last_seen_at: "2026-08-07T01:00:00Z",
        ...overrides,
      }],
    }),
    "utf8",
  );
}

test("Gmail sender review service lists pending blocked senders", async () => {
  const engineRoot = join(tempRoot, `status-${Date.now()}`);
  await seedReview(engineRoot);
  const service = createPbGmailSenderReviewService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: engineRoot },
  });
  const status = await service.status();
  assert.equal(status.counts.pending, 1);
  assert.equal(status.items[0].senderEmail, "ideas@example.com");
  assert.equal(status.items[0].messageCount, 2);
});

test("Gmail sender review service persists exact-address approval", async () => {
  const engineRoot = join(tempRoot, `approve-${Date.now()}`);
  await seedReview(engineRoot);
  const service = createPbGmailSenderReviewService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: engineRoot },
    now: () => "2026-08-07T02:00:00Z",
  });
  const status = await service.decide({ senderKey: "sender-key-1", decision: "approved" });
  assert.equal(status.counts.approved, 1);
  const registry = JSON.parse(await readFile(
    join(engineRoot, "workspace", "gmail_research_approvals", "senders.json"),
    "utf8",
  ));
  assert.equal(registry.schema_version, "gmail_research_sender_approvals.v1");
  assert.equal(registry.decisions[0].sender_email, "ideas@example.com");
  assert.equal(registry.decisions[0].decision, "approved");
});

test("Gmail sender review service does not approve authentication failures", async () => {
  const engineRoot = join(tempRoot, `blocked-${Date.now()}`);
  await seedReview(engineRoot, {
    reason: "authentication_failed",
    reviewable: false,
  });
  const service = createPbGmailSenderReviewService({
    env: { PB_DAILY_INTELLIGENCE_ENGINE_DIR: engineRoot },
  });
  await assert.rejects(
    service.decide({ senderKey: "sender-key-1", decision: "approved" }),
    /허용할 수 없습니다/,
  );
});
