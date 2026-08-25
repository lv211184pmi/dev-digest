---
name: react-query-patterns
description: "TanStack React Query conventions for client/ — where data hooks live, the query-key shape and when to extract a key factory, which keys a mutation must invalidate, the QueryClient defaults set once in providers.tsx, and the global error-toast contract that makes per-hook error handling a double-toast. Use when adding or changing a hook in client/src/lib/hooks/, wiring a component to the API, or reviewing cache invalidation. Does NOT cover component internals (see react-best-practices), file placement (see ui-architecture), RSC/routing (see next-best-practices), or live run events (see sse-streaming)."
version: 1.0.0
metadata:
  tags: frontend, react-query, tanstack, data-fetching, cache, hooks, client
---

# React Query Patterns (`client/`)

Every read of the API goes through a typed hook in `client/src/lib/hooks/`. Components
call hooks; components do not call `api` directly and never `useEffect` + `fetch`.

## Scope guardrail

| Question | Skill |
|---|---|
| "How do I fetch/mutate API data, and what must I invalidate?" | **react-query-patterns** (this skill) |
| "Where does this file go? Should it be in a feature folder?" | `ui-architecture` |
| "Is this component/hook written correctly?" | `react-best-practices` |
| "Server components, route handlers, metadata?" | `next-best-practices` |
| "Live run events over SSE" | `sse-streaming` |

## Where hooks live

`client/src/lib/hooks/` — `core.ts` holds the scaffolding domains (settings, secrets,
repos, pulls, project context); feature domains get a sibling file (`agents.ts`,
`reviews.ts`, `trace.ts`, `skills.ts`, `blast.ts`, `conventions.ts`, `repo-intel.ts`).
All are re-exported from `hooks/index.ts`, which is what components import.

Every hook file starts with `"use client"` and is typed against `../api` and `../types`
— the response type is a `@devdigest/shared` contract, not an inline shape.

## Query keys

An array, entity name first, then the ids that scope it:

```ts
queryKey: ["agents"]                    // collection
queryKey: ["agent", id]                 // one entity
queryKey: ["pr-runs", prId]             // collection scoped to a parent
```

- Never a bare string key.
- When the **same key is built in more than one place**, extract a factory next to the
  hooks that use it (`conventionsKey(repoId)` in `conventions.ts`) rather than repeating
  the literal — a drifted literal is an invalidation that silently does nothing.
- Keep the prefix stable: `["provider-models"]` invalidates every
  `["provider-models", provider]` because prefix matching is the invalidation mechanism.

## Mutations must invalidate what they wrote

A mutation lists **every** key its write affects, not just the obvious one:

```ts
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
  qc.invalidateQueries({ queryKey: ["agents"] });        // agent cards show skill counts
}
```

- **Delete** → `removeQueries` on the entity key *and* `invalidateQueries` on the
  collection (`useDeleteAgent` does both). Invalidating alone leaves a dead detail entry.
- **Write that returns the canonical entity** → `setQueryData(key, data)` instead of an
  invalidate round-trip (`useUpdateSettings`).
- **Second-order effects count.** Saving a provider key changes which models resolve, so
  `useTestConnection` invalidates `["provider-models"]` and `["secrets-status"]` — ask what
  else the server now answers differently.
- Optimistic updates cancel first: `await qc.cancelQueries({ queryKey: key })`, snapshot,
  mutate, roll back in `onError`.

## Defaults are set once

`client/src/lib/providers.tsx` configures the `QueryClient`: `retry: 1`,
`staleTime: 30_000`, `refetchOnWindowFocus: false`. Do not restate these per hook. Deviate
only with a comment saying why this query is different.

## Errors are handled globally

`QueryCache.onError` and `MutationCache.onError` in `providers.tsx` toast for you:

- **Mutations always toast** — they are user actions.
- **Queries toast only on network errors and 5xx.** An expected 4xx (a 404 "nothing yet")
  stays silent so the screen can render an inline empty state.

So: **do not add a local error toast in a hook or component** — you will double-toast. Use
the query's `error`/`isError` for inline UI only. The one documented exception is an error
that never passes through React Query at all: a runtime agent failure arriving as an SSE
`error` event is surfaced explicitly in `reviews.ts` (see `sse-streaming`).

## Anti-patterns

- `useEffect` + `fetch` + `useState` where `useQuery` belongs.
- String query keys, or duplicated key literals instead of a factory.
- `qc.invalidateQueries()` with no key — it refetches the whole app.
- A mutation that invalidates the detail key but not the collection (or vice versa).
- Inline `queryFn` re-implementing what `lib/api` already does.
- Declaring hooks inside a component file instead of `lib/hooks/`.
- Per-hook `retry` / `staleTime` that just repeats the global default.
- A local `toast.error(...)` in `onError` on top of the global handler.
