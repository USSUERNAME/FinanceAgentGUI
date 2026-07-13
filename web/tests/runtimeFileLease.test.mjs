import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { acquireRuntimeFileLease } from "../server/runtimeFileLease.mjs";

test("runtime file lease admits only one concurrent owner and fences old releases", () => {
  const root = mkdtempSync(join(tmpdir(), "finance-agent-lease-"));
  const lockPath = join(root, "emergency.lock");
  try {
    const winner = acquireRuntimeFileLease(lockPath);
    assert.equal(winner.acquired, true);
    const losers = Array.from({ length: 20 }, () => acquireRuntimeFileLease(lockPath));
    assert.equal(losers.filter((lease) => lease.acquired).length, 0);

    const owner = JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ ...owner, ownerToken: "replacement-owner" }));
    assert.equal(winner.release(), false);
    assert.equal(acquireRuntimeFileLease(lockPath).acquired, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime file lease quarantines a stale owner before taking over", () => {
  const root = mkdtempSync(join(tmpdir(), "finance-agent-stale-lease-"));
  const lockPath = join(root, "emergency.lock");
  try {
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({ ownerToken: "stale-owner" }));
    const staleDate = new Date(Date.now() - 60_000);
    utimesSync(lockPath, staleDate, staleDate);

    const replacement = acquireRuntimeFileLease(lockPath, { staleAfterMs: 1_000 });
    assert.equal(replacement.acquired, true);
    assert.notEqual(replacement.ownerToken, "stale-owner");
    assert.equal(replacement.release(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
