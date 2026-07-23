# Frontend Architecture Refactor

FinanceAgentGUI's frontend was organized into feature directories while the
root `web/src/App.jsx` still owned most feature state, network requests,
polling, timers, and event handlers. This refactor changes ownership rather
than splitting files for its own sake: each feature should be independently
changeable, testable, and repairable while preserving visible behavior.

## Baseline

The pre-refactor snapshot has the following measured shape:

- `App.jsx`: 7,869 lines and 315,229 bytes.
- `App()` body: 139 `useState` calls, 36 `useEffect` calls, 148 declared
  handlers, and 63 direct `fetch` calls.
- `TransactionStatusView.jsx`: 10,966 lines, 129 `useState` calls, and 64
  `useEffect` calls.
- `styles.css`: 20,911 lines with feature styles sharing one global cascade.
- Baseline verification: 382 Node tests and the Vite production build pass.

These counts are diagnostics, not acceptance criteria by themselves. A smaller
file that merely moves the same global state into one giant Context is not a
successful refactor.

## Problem Definition

1. **Feature ownership is inverted.** Feature views receive data from `App`,
   while `App` performs their requests, polling, error handling, and settings
   persistence.
2. **Unrelated changes share one render boundary.** A state change in one
   feature can re-run the root component that owns every other feature's state.
3. **Effects are hard to reason about.** Mount polling, route-open behavior,
   notification effects, and persistence effects are interleaved in one long
   effect block.
4. **API contracts are not localized.** The root component directly knows more
   than thirty endpoint families.
5. **The second bottleneck is already visible.** `TransactionStatusView.jsx`
   has accumulated the same state/effect concentration inside a feature module.
6. **Global CSS raises change amplification.** Feature-specific selectors and
   responsive rules share one file and one cascade.

## Target Ownership Model

- `App.jsx` owns only application-shell concerns: active route, cross-feature
  agent session selection, global navigation, and truly shared context.
- A feature controller hook owns that feature's requests, polling, route-open
  behavior, settings state, and actions.
- Pure request construction and response validation live in feature API
  modules, not JSX components.
- Feature views receive one cohesive feature model or a small number of grouped
  props instead of dozens of unrelated root-level values.
- React Context is introduced only when multiple independent descendants need
  the same live state. It is not the default destination for extracted state.
- Deterministic protocol parsing and validation remain deterministic. Semantic
  classification uses the existing LLM harness boundary.
- astop process observation remains a backend concern and must stay independent
  from the React refactor.

## Refactor Sequence

1. Establish regression tests and structural boundary tests.
2. Extract low-risk feature API/controller boundaries, beginning with News
   Feed, then World Memory, Magazine, Arca, and Toss.
3. Separate route rendering from the application shell after feature ownership
   has moved out of `App`.
4. Split feature CSS after component ownership is stable.
5. Decompose `TransactionStatusView` by transaction mode and shared market-data
   controller boundaries.
6. Run the complete tests, build, LLM observation audit, browser interaction
   QA, release-safety scan, and final structural audit.

## Implemented Ownership

The refactored tree uses the following boundaries:

- Feature API modules own endpoint paths, request construction, JSON response
  validation, structured errors, and abort-signal forwarding.
- Feature controller hooks own feature-local state, polling, route-open loads,
  persistence, and actions for News Feed, World Memory, Magazine, Arca, Toss
  Invest, shared memory, notifications, portfolio canvases, and transaction
  settings.
- `shell/AppRoutes.jsx` owns route selection, route-level lazy imports, loading
  fallbacks, and route view composition. `App.jsx` supplies lazy model factories
  so only the active route's prop model is materialized during a root render.
- `agent/useAgentRuntimeController.js` owns provider enablement, saved
  selections, model-catalog refresh, runtime profile construction, and
  reasoning/speed normalization.
- `agent/useChatComposerController.js` owns scoped chat messages, prompts,
  attachments, abort handles, drag/drop state, composer sizing, and the
  system/World Memory/portfolio-canvas scope switch. `agent/chatStreamRunner.js`
  owns SSE decoding, render throttling, terminal status normalization, and
  partial-answer recovery for both normal chat and earning analysis.
- `MagazineWorkspace.jsx` owns the Magazine reading surface and is loaded only
  for the Magazine route.
- Transaction Status delegates shell, watchlist, simulator, display-settings,
  and shared market-data state to dedicated hooks. Its market-data controller
  owns provider checks, watchlist and simulator prices, market calendars,
  USD/KRW rate loading, live investment-status retries, page-visibility
  recovery, and all refresh timers.
- Transaction rendering lives in `TransactionStatusViews.jsx`; deterministic
  transaction normalization and calculations live in `transactionDomain.js`.
  Neither module owns polling or remote request state.
- Each major feature imports its own stylesheet. The global stylesheet keeps
  base tokens, shared shell primitives, and genuinely cross-route overlays.
- The responsive shell sheds the right agent sidebar first at 980 px, keeps the
  left navigation and main workspace intact, then hides the left navigation at
  760 px. The main workspace is therefore the last column removed or reduced.
- Structural tests assert these ownership rules so direct endpoint calls,
  route rendering, feature state bundles, and feature CSS cannot silently
  return to `App.jsx`.

## Post-refactor Shape

The implementation audit after extraction has the following measured shape:

- `App.jsx`: 2,238 lines and 87,116 bytes, with 10 `useState` calls and 7
  `useEffect` calls. The remaining state is cross-feature context, navigation,
  browser-notification coordination, and proposed agent actions.
- `shell/AppRoutes.jsx`: 307 lines and 12,129 bytes. Route components and lazy
  route loading no longer share the application-shell implementation file.
- `agent/useAgentRuntimeController.js`: 590 lines; agent provider settings and
  model-catalog state no longer render through root-owned state.
- `agent/useChatComposerController.js`: 359 lines; scoped composer and message
  state no longer live in `App.jsx`.
- `agent/chatStreamRunner.js`: 205 lines; both chat entry points share one SSE
  parsing, throttling, status, and partial-response contract.
- `App.jsx`: zero direct `/api/` fetch calls.
- `TransactionStatusView.jsx`: 2,582 lines and 109,092 bytes, with zero direct
  `useState` calls. Rendering, domain helpers, and market-data orchestration are
  separate modules.
- `styles.css`: 1,097 lines and 18,590 bytes. Feature CSS is emitted as
  independently loaded route chunks.

Line counts are evidence of reduced change amplification, not an ongoing size
budget. A future extraction is valid only if it creates a clearer owner or
render boundary rather than relocating a monolith unchanged.

## Verification Record

The completed refactor was verified with:

- 500 Node tests passing, including feature API contract tests and structural
  ownership tests for route rendering and responsive shell priority.
- A successful Vite production build with lazy JavaScript and CSS chunks for
  the extracted feature workspaces.
- The LLM observation audit covering all nine token-consuming process
  families.
- Read-only SQLite doctor checks for World Memory, Toss Invest, the investment
  simulator, and Magazine event signatures.
- The strict release-safety scan with zero errors and zero warnings.
- Live browser checks for all eleven routes at desktop width, the left-plus-main
  shell at 900 px, the main-only shell at 740 px, and Transaction Status at
  390 px. No relevant console errors, broken route surfaces, position-row
  overlap, or document-level horizontal overflow were observed.

## Remaining Deliberate Boundaries

- `App.jsx` still assembles the final cross-feature prompt context and applies
  post-response business actions such as report persistence, World Memory
  proposals, and portfolio widget actions. Those are application-level
  coordination points; provider state, composer state, and stream mechanics now
  remain behind agent-owned boundaries.
- Transaction chart/render helpers remain substantial but are now pure or
  view-local. They can be split further by chart, watchlist, and simulator UI
  when one of those areas changes independently.
- The production build still reports the configured large-chunk warning for
  the main application bundle and the ECharts portfolio bundle. Route-level
  feature splitting is in place; chart-engine/vendor splitting remains a
  separate performance task.

## Completion Evidence

Completion requires all of the following:

- No feature endpoint family is called directly from `App.jsx`.
- Feature polling and route-open effects live with their feature controller.
- Route-level view composition and lazy imports live in `shell/AppRoutes.jsx`;
  `App.jsx` passes active-route model factories rather than rendering feature
  views directly.
- `App.jsx` contains no feature-local state bundle for News Feed, World Memory,
  Magazine, Arca, Toss, or transaction status.
- `TransactionStatusView` is decomposed without changing the visible ordering,
  account, simulator, currency, chart, or watchlist contracts.
- Feature styles are imported from feature-owned files; the global stylesheet
  contains only tokens, reset/base rules, and shared shell primitives.
- Structural boundary tests prevent the extracted concerns from returning to
  the root.
- The baseline functional test suite remains green and rendered desktop/mobile
  smoke tests show no relevant console errors or broken interactions.
