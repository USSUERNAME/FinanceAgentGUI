import { readJsonBody, sendJson } from "./codexProbe.mjs";
import {
  appendSharedMemoryRecord,
  buildSharedMemoryContextPacket,
  deleteSharedMemoryRecord,
  sharedMemoryStatus,
} from "./sharedMemoryStore.mjs";
import { runEmergencyProcedureForMarketSummary } from "./notificationsApi.mjs";

async function sharedMemoryStatusWithEmergencyProcedure(options = {}) {
  const status = sharedMemoryStatus(options);
  const marketSummary = status.contextMemory?.marketSummary || null;
  if (!marketSummary || typeof marketSummary !== "object") return status;
  try {
    const emergencyProcedure = await runEmergencyProcedureForMarketSummary(marketSummary);
    return {
      ...status,
      contextMemory: {
        ...status.contextMemory,
        marketSummary: {
          ...marketSummary,
          emergencyProcedure,
        },
      },
    };
  } catch (error) {
    return {
      ...status,
      contextMemory: {
        ...status.contextMemory,
        marketSummary: {
          ...marketSummary,
          emergencyProcedure: {
            ok: false,
            skipped: true,
            reason: "emergency-procedure-error",
            error: error.message,
          },
        },
      },
    };
  }
}

function methodNotAllowed(res) {
  sendJson(res, { ok: false, error: "method not allowed" }, 405);
}

export async function handleMemoryEndpoint(kind, req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");

    if (kind === "context") {
      if (req.method !== "POST") {
        methodNotAllowed(res);
        return;
      }
      const payload = await readJsonBody(req);
      const packet = buildSharedMemoryContextPacket(payload);
      const status = await sharedMemoryStatusWithEmergencyProcedure();
      sendJson(res, {
        ok: true,
        ...packet,
        emergencyProcedure: status.contextMemory?.marketSummary?.emergencyProcedure || null,
      });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, await sharedMemoryStatusWithEmergencyProcedure({ limit, offset }));
      return;
    }

    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      const record = appendSharedMemoryRecord(payload);
      sendJson(res, {
        ok: true,
        record,
        status: await sharedMemoryStatusWithEmergencyProcedure(),
      });
      return;
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      const result = deleteSharedMemoryRecord(id);
      if (!result.ok) {
        sendJson(res, result, result.error === "record not found" ? 404 : 400);
        return;
      }
      sendJson(res, {
        ok: true,
        deleted: true,
        id: result.id,
        status: await sharedMemoryStatusWithEmergencyProcedure({ limit, offset }),
      });
      return;
    }

    methodNotAllowed(res);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
}
