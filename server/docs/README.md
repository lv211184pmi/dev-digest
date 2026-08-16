# server/docs

How the API works today. Deep dives that are too long for `README.md` and too
stable for `INSIGHTS.md`.

Good candidates: the run lifecycle and orphan reaping, the DI container and how
to add an adapter, the secrets read path, migration/seed workflow, SSE run
traces, rate-limit tiers.

Not here: the API route map (that is `../README.md`), intent for unbuilt work
(`../specs/`), rejected approaches (`../INSIGHTS.md`).

Two modules keep their own README next to the code — link to them rather than
copying them:

- [`../src/modules/repo-intel/README.md`](../src/modules/repo-intel/README.md) —
  the indexer pipeline and the `repoIntel.*` facade.
- [`../src/modules/blast/README.md`](../src/modules/blast/README.md) — the PR
  impact map: request pipeline, the four rings, and the coverage rules behind
  `index.state`.
