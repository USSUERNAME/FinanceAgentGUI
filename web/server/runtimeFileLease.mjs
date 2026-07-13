import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_STALE_AFTER_MS = 3 * 60 * 1000;

function readOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function lockAgeMs(lockPath, nowMs) {
  try {
    return Math.max(0, nowMs - statSync(lockPath).mtimeMs);
  } catch {
    return 0;
  }
}

function quarantineStaleLock(lockPath) {
  const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch {
    return false;
  }
  rmSync(quarantinePath, { recursive: true, force: true });
  return true;
}

export function acquireRuntimeFileLease(
  lockPath,
  {
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    now = () => Date.now(),
  } = {},
) {
  const ownerToken = randomUUID();
  const startedAtMs = now();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(dirname(lockPath), { recursive: true });
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, "owner.json"),
        `${JSON.stringify({ ownerToken, pid: process.pid, startedAt: new Date(startedAtMs).toISOString() }, null, 2)}\n`,
        "utf8",
      );
      let released = false;
      return {
        acquired: true,
        ownerToken,
        release() {
          if (released) return false;
          released = true;
          const owner = readOwner(lockPath);
          if (owner?.ownerToken !== ownerToken) return false;
          rmSync(lockPath, { recursive: true, force: true });
          return true;
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stale = lockAgeMs(lockPath, now()) >= staleAfterMs;
      if (!stale || attempt > 0 || !quarantineStaleLock(lockPath)) {
        return {
          acquired: false,
          ownerToken: "",
          owner: readOwner(lockPath),
          release: () => false,
        };
      }
    }
  }

  return { acquired: false, ownerToken: "", owner: readOwner(lockPath), release: () => false };
}
