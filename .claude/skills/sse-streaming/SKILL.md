---
name: sse-streaming
description: "Live run events end to end — the in-memory RunBus in server/src/platform/sse.ts (publish, replay-first subscribe, complete, onDone, cancel), the SSE route's async-generator bridge and its rate-limit exemption, and the EventSource consumer in client/src/lib/hooks/reviews.ts including why SSE error events need their own toast. Use when adding or changing a run event kind, a stream endpoint, cancellation, or the client's live-run UI. Does NOT cover cache invalidation generally (see react-query-patterns), Fastify plugin mechanics (see fastify-best-practices), or which ring emits (see onion-architecture)."
version: 1.0.0
metadata:
  tags: sse, streaming, events, run-events, fastify, eventsource, full-stack
---

# SSE Streaming (run events)

One long-lived connection per run carries `RunEvent`s from the server's in-memory bus to
the browser. The stream is **replay-first**: a subscriber that connects late still sees
every event from the start, then the stream ends. Preserve that property in any change.

## Scope guardrail

| Question | Skill |
|---|---|
| "How do run events flow server → client? How do I add an event kind?" | **sse-streaming** (this skill) |
| "What should a mutation invalidate after a run finishes?" | `react-query-patterns` |
| "Is the route/plugin written correctly?" | `fastify-best-practices` |
| "Which layer may publish an event?" | `onion-architecture` |
| "What does the engine emit during a review?" | `reviewer-core-engine` |

## Server: the bus

`server/src/platform/sse.ts` — `RunBus`, a module-level singleton (`runBus`) holding, per
run: an `EventEmitter`, a **buffer of every event**, a monotonic `seq`, and completion /
cancellation flags.

| Method | Contract |
|---|---|
| `publish(runId, kind, msg, data?)` | stamps `seq` + `t`, appends to the buffer, emits live |
| `subscribe(runId, listener)` | **replays the buffer first**, then attaches; returns an unsubscribe |
| `onDone(runId, listener)` | fires immediately (via `queueMicrotask`) if the run already completed |
| `buffer(runId)` | the full log — the service layer persists it as one `run_traces` document |
| `complete(runId)` | emits `done`, drops the emitter, keeps the buffer briefly for late subscribers |
| `cancel` / `isCancelled` | cooperative: the runner checks at its next checkpoint |

Two rules follow directly:

- **`onDone` firing immediately for a finished run is load-bearing.** It is what lets a
  late subscriber replay and then *end* instead of hanging on an open connection forever.
- **The bus does not persist.** Persistence is the service layer's job; do not add a DB
  write inside `sse.ts`.

Publishing is an application/infrastructure concern — `platform/container` is not
importable from `domain-model` or `domain-services`. A domain function that "needs to log
progress" should return something the caller publishes.

## Server: the route

`GET /runs/:id/events` (`server/src/modules/reviews/routes.ts`) bridges the callback bus to
an async generator that `reply.sse()` drains, yielding
`{ id: String(seq), event: kind, data: JSON.stringify(event) }`.

- **`config: { rateLimit: false }` is mandatory.** SSE is one long-lived connection, not
  burst traffic; the default limiter would kill live runs.
- The generator's `finally` block must `unsubscribe()` and `offDone()` — a dropped client
  otherwise leaks a listener for the process's lifetime.
- Never buffer-then-send or `JSON.stringify` the whole log; the point is incremental
  delivery.

## Client: the consumer

`client/src/lib/hooks/reviews.ts` opens one `EventSource` per run id against
`${API_BASE}/runs/${runId}/events`.

- **Listen twice.** The server names each event with its `kind`, so the hook sets
  `es.onmessage` *and* `addEventListener` for each kind (`info`, `tool`, `result`,
  `error`). A **new event kind not added to that list is silently dropped by the client** —
  this is the single most common bug when adding a kind.
- Non-JSON frames (keepalives, dataless native errors) are swallowed by the `try/catch`;
  keep that tolerance.
- **SSE `error` events need an explicit toast.** They are not query or mutation errors, so
  the global `QueryCache`/`MutationCache` handlers in `providers.tsx` never see them — the
  hook calls `notify.error` itself. This is the documented exception to
  `react-query-patterns`' "no local error toasts" rule.
- `es.onerror` closes that source and decrements the open count; the effect cleanup closes
  **every** source. Both paths must run or the UI stays stuck "running".
- When runs settle, invalidate `["pr-active-runs", prId]` and `["pr-runs", prId]` so the
  cached history matches what the stream just showed.

## Adding a new event kind — the order

1. Add it to `RunEventKind` in `@devdigest/shared` (contracts change in shared first).
2. Publish it via `runBus.publish` from an application/infrastructure caller.
3. Add it to the client's `addEventListener` kind list.
4. Decide whether it should also invalidate a query key.

Skipping (3) produces a change that typechecks, passes tests, and does nothing visible.

## Anti-patterns

- Rate-limiting, caching, or compressing the SSE route.
- Polling `GET /pulls/:id/runs` in a loop instead of subscribing.
- Publishing from `domain-model` / `domain-services`.
- Persisting inside `RunBus`, or clearing the buffer on `complete` (late subscribers).
- Adding an event kind in shared without adding it to the client listener list.
- Dropping the `finally` unsubscribe, or the effect cleanup that closes sources.
- Assuming the subscriber connects before the first event — replay exists precisely because it does not.
