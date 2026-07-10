# Transaction Status Agent Context

The `거래현황` screen publishes the actual rendered state to the right sidebar agent. The contract follows the selected screen instead of rebuilding an approximate view from backend APIs.

## Direct context

The following values are included directly in `[거래현황 컨텍스트]`:

- active section and view mode;
- live or simulator account identity;
- selected watchlist group;
- display currencies, sort, selected table columns, and chart controls;
- the visible `내 투자` or simulator sidebar position list;
- the currently filtered main investment table rows;
- the selected watchlist group's visible main table rows.

The live-account and simulator overview share the same row schema. Consumers must still preserve `account.type` and never interpret a simulator row as a real holding or order.

The watchlist screen uses `account.type: "watchlist"` so a previously selected simulator or live account cannot leak into the selected-group context.

## Chart retrieval

A selected investment, watchlist symbol, or simulator symbol publishes a `transaction-status-display-data.v1` chart snapshot. Its compact summary is included directly. Complete displayed candles, daily rows, price series, and volume series stay in the local request payload and are chunked into a request-scoped `query-scoped-local-rag` index.

Only chunks relevant to the user's current query are added under `[거래현황 차트 데이터 RAG 검색 결과]`. The retrieval query is sent separately from agent action instructions so widget and execution guidance does not pollute chart retrieval.

## Privacy and lifetime

Transaction context is local reference data. It is not written to `data/shared-memory/`, not appended to chat memory summaries, and not stored as a persistent vector index. The current screen replaces the previous transaction packet, and the packet is sent only while the active screen is `transaction-status`.
