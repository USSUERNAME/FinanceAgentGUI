# Report Files

FinanceAgentGUI uses a file-based report system. The local app does not need a report database for ordinary browsing, search, or reading.

## Storage

- Generated user-facing reports should be written under `data/reports/`.
- The Reports page does not automatically accumulate World Memory artifacts from
  `logs/world-memory/`. Keep World Memory review output on the World Memory
  surface unless a user explicitly saves a user-facing report.
- A standalone checkout or copied app folder should still work with these paths.
- Runtime report files are local user state and should stay gitignored.

## API

- The web server exposes `GET /api/reports`.
- Sidebar-agent generated reports can be saved with `POST /api/reports`.
- Report deletion uses `DELETE /api/reports?id=<report-id>` after explicit UI confirmation.
- The endpoint scans configured report folders, reads supported files, and returns normalized report metadata plus display sections.
- `POST /api/reports` accepts a validated `save_report_artifact` payload and writes a Markdown file under `data/reports/`.
- Completed agent-chat answers can use the `save_chat_answer` action on the same endpoint. If the answer already contains a Markdown H1, the server preserves that first H1 exactly as the report title and does not prepend a duplicate heading. Only answers without an H1 ask the configured low-cost translation model for a short Korean title; that title is prepended to the preserved Markdown answer before persistence.
- Delete requests accept only the opaque report id from the list response; file paths are not a UI/API input.
- Supported extensions are `.md`, `.markdown`, `.txt`, `.html`, and `.json`.
- `FINANCE_AGENT_GUI_REPORT_DIRS` can add extra local report folders. Separate paths with the host platform path delimiter.

## Generation Catalog

- `config/report-catalog.json` is the self-contained catalog of report procedures injected into sidebar-agent context on the Reports screen.
- The catalog is advisory until a specific job runner is implemented. Agents should use it to choose a report type, explain fit, collect missing inputs, and propose an approved execution path.
- Report-generating procedures should write user-facing artifacts under `data/reports/` unless a future workflow documents a different runtime folder under `data/`.
- Clear report-writing requests on the Reports screen use an LLM-controlled `report_artifact` action. The GUI hides the action block, validates the schema, saves the Markdown artifact, then refreshes the visible list.
- If a completed Reports-screen answer omits or malforms that action, the server runs a second structured LLM decision over the original request and completed answer. Only an explicit report-generation intent plus a complete report at high confidence is recovered and saved; ordinary or ambiguous chat remains chat-only.
- The recovery decision uses a strict JSON schema and a confidence gate. It is a semantic classifier, not a keyword/regex fallback, and a classifier failure must be shown as a save-verification error without discarding the completed chat answer.
- Ordinary chat, catalog questions, and ambiguous draft/planning requests should not emit `report_artifact`; they remain sidebar chat only.
- Generated reports should preserve the original finance-agent writing process, not necessarily its file/folder mechanics: gather and cross-check market data, FEED/News Feed, World Memory, web research, and official sources internally, then write a reader-facing judgment.
- Reports should start with a reader-facing summary, quick judgment, thesis, table, scenario, or conclusion path. Do not front-load separate `World Memory evidence`, `News Feed evidence`, or `web verification evidence` sections.
- Evidence should support the body, not consume the opening. Attribute key facts naturally in prose, and collect external URLs or source links in a short footnote/reference section near the bottom when links are useful.
- The report body should not explain save paths, Markdown artifacts, or GUI storage mechanics unless the user specifically asks about implementation.
- The catalog carries the main original finance-agent report families: company/stock analysis, earnings analysis, market situation analysis, market risk analysis, macro/policy outlook, sector/industry analysis, portfolio diagnosis, ETF/fund comparison, World Memory driver reports, recent-industry newsletters, and long-form research dossiers.

## Urgent Market Updates

- `POST /api/notifications/emergency-report` creates a short urgent market update report from the existing shared-memory external market summary.
- This path intentionally does not perform web search and does not re-scan raw News Feed items. It uses the already-compressed context summary as the model input.
- The 15-minute external market summary now includes its own semantic severity
  assessment. When `/api/memory` observes `urgent` or `critical`, it runs the
  same emergency report plus browser-notification procedure once for that
  reportable episode. Continued `urgent` or continued `critical` summaries are
  suppressed; `urgent` can create one additional report only if it escalates to
  `critical`.
- The translation-model output is harnessed as structured JSON: severity, report title, market impact summary, known facts, and one-line push summary. The fixed uncertainty notice is appended by the server, not generated by the model.
- The generated Markdown report is saved under `data/reports/`, then the one-line push summary is sent through the local notification adapter.
- Browser notifications use the open app page. Clicking the notification focuses the app and opens `보고서`.
- The Reports sidebar item should show the red urgent state only while there is an unread urgent/critical notification. Opening Reports marks the current urgent notification as read; the next urgent report turns it on again.
- The report must state that it is a fast draft and may be inaccurate. Users who need detailed and accurate current information should use the formal `주식채널+` chat flow or another source.

## UI Contract

- The Reports page reads from `/api/reports`.
- Every completed assistant answer exposes a compact copy action and a report-folder action through the shared chat-message renderer. Pending/streaming answers do not expose these actions.
- Copy writes only the answer body, excluding provider metadata and transient status cards. It removes HTML spacing entities and normalizes Markdown headings, rules, and existing paragraph boundaries to one blank line between blocks. Structured clipboard output converts Markdown thematic breaks such as `---` to HTML `<hr>` while the plain-text fallback preserves `---`; copied report HTML keeps the rendered `<hr>` as well. Report save uses the same answer body and refreshes the Reports list after persistence.
- Action icons are quiet gray controls, gain a light gray hover surface, and temporarily become a check icon after success.
- Across every agent-chat surface, a visible progress or intermediate-judgment summary must be followed by one blank line before the final answer. Markdown headings must start at the beginning of a new line; the shared renderer repairs this boundary defensively when a provider streams both segments together.
- The shared answer/report Markdown renderer converts thematic-break syntax such as `---` into a semantic HTML `<hr>` on both chat answers and saved report bodies.
- The Reports reader is implemented in `web/src/reports/ReportsView.jsx` and is lazy-loaded by `App.jsx`.
- Search is client-side over title, category, summary, tags, and parsed section text.
- Report generation guidance should stay in the sidebar-agent context, not as a visible Reports-page catalog or report-type picker.
- File paths, extensions, and raw JSON are implementation details and should not be shown in the reader UI.
- A list item delete control should appear only for the selected or hovered/focused report.
- The UI should not require SQLite or another report index until the file count or feature set clearly demands it.

## Rich Blocks

- Markdown sections can include fenced `echarts` or `chart` blocks containing a JSON ECharts option object.
- JSON reports can include `charts: [{ heading, body, option }]`.
- Rich blocks should render as user-facing objects in the reader, not as raw code or JSON.
- ECharts option blocks must be plain JSON. For array-valued scatter data in tooltip templates, use indexed value placeholders such as `{value[0]}`, `{value[1]}`, and `{value[2]}`; the GUI renderer converts them to runtime tooltip functions before passing options to ECharts.
- The shared chart renderer in `web/src/portfolio/PortfolioEChart.jsx` registers line, pie, bar, and scatter chart types. If a report needs another ECharts series or component type, extend that runtime deliberately instead of importing the full ECharts distribution.
