# `repo-intel` — the codebase indexer

`repo-intel` reads a cloned repository **once on clone** (and incrementally on
fetch, keyed by file content hash) and turns it into queryable facts: symbols,
the import graph, a PageRank-based file importance score, and a compact **repo
map** (the project skeleton). On a review it is only **read** — the index is
already computed, so adding context to a prompt costs no analysis at request time.

This is **starter infrastructure**: it works from day 1 (the **Indexed** badge),
but you don't write it. Course lessons build features _on top_ of its facade —
Blast Radius (L04), Conventions samples (L02), Onboarding reading-path (L05),
the Phantom-API gate (L06) — by calling `repoIntel.*`, not by re-indexing.

## Pipeline

```mermaid
flowchart LR
  CLONE["git clone / fetch"] --> WALK["walk.ts<br/>discover source files"]
  WALK --> AST["ast-grep adapter<br/>symbols + references"]
  AST --> EDGES["import graph<br/>(dependency-cruiser)"]
  EDGES --> RANK["rank.ts<br/>PageRank + git hotness → file rank"]
  RANK --> MAP["repo-map.ts<br/>compact repo skeleton (cached)"]
  AST --> DB[("Postgres<br/>symbols · references · file_edges · file_rank · repo_map_cache")]
  EDGES --> DB
  RANK --> DB
  MAP --> DB
```

Full vs incremental indexing lives in `pipeline/{full,incremental}.ts`; an
unindexed or partially-indexed repo degrades gracefully (the facade returns empty
results rather than throwing).

## Facade (`repoIntel.*`)

Everything downstream reads through one facade (`service.ts`) so consumers never
touch the pipeline internals:

- `getRepoMap(repoId)` → the cached repo skeleton (fed into the **review prompt**).
- `getFileRank(repoId, files)` → importance percentile per changed file.
- `getCallerSignatures(repoId, files, limit)` → callers of changed symbols.
- `getBlastRadius(repoId, files)` → changed symbols + **every** resolved caller,
  grouped by changed symbol and rank-sorted within each group (used by L04).
  Deliberately uncapped: `MAX_CALLERS_PER_SYMBOL` is a display rule the consumer
  applies, because a consumer handed a pre-truncated list can neither report an
  honest pre-cap count nor attribute endpoints from the callers it never saw.
- `getImpactedFiles(repoId, changedFiles)` → a reverse `file_edges` walk to
  `BFS_DEPTH = 2` joined against `file_facts`: which files sit downstream of the
  changed set, and what endpoints/crons they declare (used by L04).
- `getUnresolvedReferences(repoId, …)` → phantom-symbol detection (used by L06).
- `getConventionSamples(repoId)` → top-ranked files for convention extraction (L02).

In the starter, only `getRepoMap` / `getFileRank` / `getCallerSignatures` are
wired — into `modules/reviews/run-executor.ts`, which adds the repo map and a
high-blast-radius note to the prompt. Toggled by `REPO_INTEL_ENABLED` (global)
and a per-agent `repo_intel` flag. L04 added the first consumer of
`getBlastRadius` + `getImpactedFiles`: see
[`../blast/README.md`](../blast/README.md).

**Gating these reads is deliberate, not defensive.** With the flag off or the
index unusable, `getCallerSignatures` returns `[]` and `getBlastRadius` /
`getImpactedFiles` return an empty result carrying `degraded: true` and a
`DegradedReason` — none of them falls through to the ripgrep path, which walks
the entire clone per call with no cache, cap or timeout. A consumer's job is to
surface that reason, never to render the empty result as "nothing found".

## Routes

- `GET /repos/:id/index-state` — index status (drives the **Indexed** badge).
- `POST /repos/:id/resync` — enqueue a re-index.
