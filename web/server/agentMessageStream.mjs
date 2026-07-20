function normalizePhase(value) {
  const phase = String(value || "").trim().toLowerCase();
  return phase === "commentary" || phase === "final_answer" ? phase : "";
}

/**
 * Codex app-server can emit multiple agentMessage items in one turn. Commentary
 * and the terminal answer share the same delta notification shape, so callers
 * must key deltas by itemId and wait for the item's phase instead of blindly
 * concatenating every assistant message.
 */
export function createAgentMessageStreamState() {
  const phases = new Map();
  const textByItem = new Map();
  let finalItemId = "";
  let finalAnswer = "";
  let lastUnknownCompleted = "";

  function start(item = {}) {
    const itemId = String(item.id || "").trim();
    if (!itemId || item.type !== "agentMessage") return;
    phases.set(itemId, normalizePhase(item.phase));
    if (!textByItem.has(itemId)) textByItem.set(itemId, String(item.text || ""));
  }

  function delta(params = {}) {
    const itemId = String(params.itemId || "").trim();
    const text = String(params.delta || "");
    if (!text) return { kind: "ignore", text: "", answer: finalAnswer };

    const nextItemText = `${textByItem.get(itemId) || ""}${text}`;
    textByItem.set(itemId, nextItemText);
    const phase = phases.get(itemId) || "";
    if (phase === "commentary") {
      return { kind: "commentary", text: "", answer: finalAnswer };
    }
    if (phase !== "final_answer") {
      return { kind: "buffer", text: "", answer: finalAnswer };
    }

    if (finalItemId !== itemId) {
      finalItemId = itemId;
      finalAnswer = "";
    }
    finalAnswer += text;
    return { kind: "delta", text, answer: finalAnswer };
  }

  function complete(item = {}) {
    const itemId = String(item.id || "").trim();
    if (item.type !== "agentMessage") {
      return { kind: "ignore", text: "", answer: finalAnswer };
    }
    const phase = normalizePhase(item.phase) || phases.get(itemId) || "";
    const text = String(item.text || textByItem.get(itemId) || "");
    if (itemId) {
      phases.set(itemId, phase);
      textByItem.set(itemId, text);
    }

    if (phase === "commentary") {
      return { kind: "commentary", text: "", answer: finalAnswer };
    }
    if (phase === "final_answer") {
      const changed = finalItemId !== itemId || finalAnswer !== text;
      finalItemId = itemId;
      finalAnswer = text;
      return { kind: changed ? "message" : "ignore", text, answer: finalAnswer };
    }

    // Older providers may omit phase. Keep only the latest completed unknown
    // item as a turn-final fallback; do not expose it before turn/completed.
    if (text) lastUnknownCompleted = text;
    return { kind: "buffer", text: "", answer: finalAnswer };
  }

  function answer() {
    return finalAnswer || lastUnknownCompleted;
  }

  return { start, delta, complete, answer };
}
