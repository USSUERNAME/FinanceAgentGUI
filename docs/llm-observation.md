# LLM Process Observation

FinanceAgentGUI has one observation boundary for every local process that can
spend LLM tokens. The process inventory is tracked in
`config/llm-processes.json`; the shared launcher is
`web/server/llmProcessObserver.mjs`.

## Runtime Policy

- `supported:true` and `installed:true`: astop observation is mandatory. The
  LLM is held behind a gate until its exact PID has been registered. An astop
  `until start` wait must first confirm that astop has actually sampled that PID;
  only then is model execution released. A second wait remains connected through
  termination. The event PID and exit state are verified, the exact event is
  acknowledged, and the temporary watch is removed.
- If the app exits before it can acknowledge a completed LLM, astop retains the
  terminal notification. Server startup recovers only jobs with the app-owned
  `finance-gui-llm-` prefix, records the outcome, acknowledges the exact event,
  and removes that watch. Unrelated astop notifications are never bulk-acked.
- installed astop with an unhealthy server, failed registration, or unverifiable
  terminal delivery: fail closed. Do not start or retry the LLM outside astop.
- unsupported platform, `installed:false`, or `installed:null`: execute the
  original provider command directly, without an astop registration step.
- astop observes only. Provider cancellation, timeout, and process lifecycle stay
  owned by the existing app path.

The installed rule is independent of the general embedded-agent `enabled` and
`useForAgentTasks` settings. Those settings control agent context and sandbox
network access; they cannot create an unobserved LLM bypass.

## Covered Process Families

The manifest covers generic chat and app-server turns, World Memory management,
News Feed translation, economic-calendar translation, Toss ETF-name translation,
shared-memory market summaries, Magazine decisions and comments, the Magazine
generation orchestrator, and every inner Magazine writer/reviewer/classifier
pass. Model discovery and version probes are not generation processes and do not
spend inference tokens.

## Audit And Local Evidence

Run from `web/`:

```bash
npm run llm:observation:audit
```

The audit rejects missing manifest entrypoints, missing shared launchers, and
known direct Codex/Antigravity generation spawn patterns. Runtime registration,
completion, and failure records are written to ignored local file
`logs/llm-observation.jsonl`. The log contains feature/provider/model labels and
observation identifiers, never prompts, arguments, credentials, or model output.
