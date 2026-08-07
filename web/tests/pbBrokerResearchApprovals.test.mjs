import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPbBrokerResearchApprovalService,
  inferDriveReportMetadata,
} from "../server/pbBrokerResearchApprovals.mjs";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("Drive report filename inference creates rights-safe metadata", () => {
  const metadata = inferDriveReportMetadata({
    id: "file-1",
    name: "20260727_SK증권_반도체_소음보다신호를.pdf",
    modifiedTime: "2026-07-27T01:00:00Z",
  });
  assert.equal(metadata.publisher, "SK증권");
  assert.equal(metadata.title, "소음보다신호를");
  assert.equal(metadata.published_at, "2026-07-27T00:00:00+09:00");
  assert.deepEqual(metadata.research.sectors, ["반도체"]);
  assert.equal(metadata.analysis_allowed, true);
  assert.equal(metadata.redistribution_allowed, false);
  assert.equal(metadata.market_scope, "KR");
  assert.equal(metadata.base_currency, "KRW");
});

test("Drive report inference preserves overseas market and currency metadata", () => {
  const metadata = inferDriveReportMetadata({
    id: "file-us-1",
    name: "20260727_MorganStanley_Semiconductors_AI-Capex.pdf",
    modifiedTime: "2026-07-27T01:00:00Z",
    researchPath: ["GLOBAL", "US"],
  });
  assert.equal(metadata.publisher, "MorganStanley");
  assert.equal(metadata.title, "AI-Capex");
  assert.equal(metadata.market_scope, "US");
  assert.equal(metadata.issuer_country, "US");
  assert.equal(metadata.original_language, "en");
  assert.equal(metadata.base_currency, "USD");
  assert.deepEqual(metadata.research_path, ["GLOBAL", "US"]);
});

test("Drive report inference accepts a market token in the file name", () => {
  const metadata = inferDriveReportMetadata({
    id: "file-jp-1",
    name: "20260727_JP_Nomura_Robotics_Outlook.pdf",
    modifiedTime: "2026-07-27T01:00:00Z",
  });
  assert.equal(metadata.publisher, "Nomura");
  assert.equal(metadata.market_scope, "JP");
  assert.equal(metadata.original_language, "ja");
  assert.equal(metadata.base_currency, "JPY");
});

test("Drive approval service lists pending files and persists explicit approval", async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), "pb-drive-approval-"));
  const env = {
    PB_DAILY_INTELLIGENCE_ENGINE_DIR: engineRoot,
    GOOGLE_DRIVE_CLIENT_ID: "client",
    GOOGLE_DRIVE_CLIENT_SECRET: "secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "refresh",
    GOOGLE_DRIVE_RESEARCH_FOLDER_ID: "folder",
  };
  const files = [
    {
      id: "file-1",
      name: "20260727_SK증권_반도체_소음보다신호를.pdf",
      modifiedTime: "2026-07-27T01:00:00Z",
      size: "1234",
    },
  ];
  const fetchImpl = async (url) => (
    String(url).startsWith("https://oauth2.googleapis.com/")
      ? jsonResponse({ access_token: "token" })
      : jsonResponse({ files })
  );
  const service = createPbBrokerResearchApprovalService({
    env,
    fetchImpl,
    now: () => "2026-07-27T03:00:00Z",
  });

  const before = await service.status();
  assert.equal(before.counts.pending, 1);
  assert.equal(before.items[0].state, "pending");

  const after = await service.decide({ fileId: "file-1", decision: "approved" });
  assert.equal(after.counts.pending, 0);
  assert.equal(after.counts.approved, 1);

  const stored = JSON.parse(await readFile(
    join(engineRoot, "workspace", "broker_research_approvals", "google_drive.json"),
    "utf8",
  ));
  assert.equal(stored.decisions[0].decision, "approved");
  assert.equal(stored.decisions[0].metadata.publisher, "SK증권");
});

test("Drive approval service discovers research PDFs in market subfolders", async () => {
  const engineRoot = await mkdtemp(join(tmpdir(), "pb-drive-nested-"));
  const env = {
    PB_DAILY_INTELLIGENCE_ENGINE_DIR: engineRoot,
    GOOGLE_DRIVE_CLIENT_ID: "client",
    GOOGLE_DRIVE_CLIENT_SECRET: "secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "refresh",
    GOOGLE_DRIVE_RESEARCH_FOLDER_ID: "root-folder",
  };
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) {
      return jsonResponse({ access_token: "token" });
    }
    const query = new URL(String(url)).searchParams.get("q") || "";
    if (query.includes("'root-folder'")) {
      return jsonResponse({
        files: [
          {
            id: "global-folder",
            name: "GLOBAL",
            mimeType: "application/vnd.google-apps.folder",
            modifiedTime: "2026-07-27T01:00:00Z",
          },
        ],
      });
    }
    if (query.includes("'global-folder'")) {
      return jsonResponse({
        files: [
          {
            id: "file-global-1",
            name: "20260727_UBS_AI-Infrastructure_Outlook.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-07-27T02:00:00Z",
            size: "4321",
          },
        ],
      });
    }
    return jsonResponse({ files: [] });
  };
  const service = createPbBrokerResearchApprovalService({ env, fetchImpl });
  const state = await service.status();
  assert.equal(state.counts.pending, 1);
  assert.deepEqual(state.items[0].inferred.research_path, ["GLOBAL"]);
  assert.equal(state.items[0].inferred.market_scope, "GLOBAL");
  assert.equal(state.items[0].inferred.publisher, "UBS");
});
