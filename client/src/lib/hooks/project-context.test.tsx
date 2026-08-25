/* The first hook test in this codebase (client/src/lib carries only
   pure-helper tests today). Added deliberately: the cancel-and-replace and
   no-toast-on-abort behaviour is invisible to a component test and is
   precisely the kind of thing that regresses silently. `renderHook` +
   `QueryClientProvider` + a mocked `fetch` — assertions read the cache via
   `queryClient.getQueryData`, never internal refs. */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSetAgentContextDocs, useSetSkillContextDocs } from "./project-context";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A controllable `fetch` double: each call is queued rather than resolved
    immediately, so a test can decide resolution order — including resolving
    a *later* call before an earlier, superseded one. Honours the caller's
    `AbortSignal` the same way the real `fetch` does, so the hook's own
    abort-detection branch (`controller.signal.aborted`) is genuinely
    exercised rather than assumed.

    `autoRejectOnAbort` (default `true`) makes an aborted call's promise
    reject on its own, matching a `fetch` implementation that surfaces the
    abort as a rejection — this is what drives `mutationFn`'s own
    `SUPERSEDED` branch. Passing `false` decouples "aborted" from "always
    rejects": the call's `AbortController.signal.aborted` still flips to
    `true` the moment it is aborted, but the promise itself stays pending
    until the test explicitly settles it — the real-world race where a
    superseded request's response still arrives (resolves) rather than
    erroring. Without this, a test can never actually reach `onSuccess`'s own
    `result.seq !== seq.current` guard for a superseded call — every abort
    would already have been discarded one guard earlier, by the `SUPERSEDED`
    sentinel, which is a different code path (PR2). */
function mockFetchQueue({ autoRejectOnAbort = true }: { autoRejectOnAbort?: boolean } = {}) {
  const calls: { reject: (e: unknown) => void; resolve: (body: unknown) => void }[] = [];
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      calls.push({
        resolve: (body: unknown) =>
          resolve({ ok: true, status: 200, json: async () => body } as Response),
        reject,
      });
      if (autoRejectOnAbort) {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }
    });
  });
  return { fetchMock, calls };
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useSetAgentContextDocs / useSetSkillContextDocs", () => {
  it("cancels the in-flight PUT when a newer one is issued, and the cache ends holding the second response even if the first resolves later (R3)", async () => {
    // `autoRejectOnAbort: false` (PR2) decouples "aborted" from "always
    // rejects": the first request's underlying fetch stays pending after
    // its controller is aborted, so this test can resolve it *normally*
    // later — the real-world race where a superseded response still
    // arrives. That is the only way to genuinely reach `onSuccess`'s
    // `result.seq !== seq.current` guard rather than the earlier
    // `SUPERSEDED`-sentinel branch, which a plain auto-rejecting abort would
    // always take first.
    const { fetchMock, calls } = mockFetchQueue({ autoRejectOnAbort: false });
    vi.stubGlobal("fetch", fetchMock);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const listKey = ["agent-context-docs", "ag1", "r1"];
    qc.setQueryData(listKey, [{ path: "docs/a.md", order: 0 }]);

    const { result } = renderHook(() => useSetAgentContextDocs("ag1"), {
      wrapper: wrapperFor(qc),
    });

    act(() => {
      result.current.mutate({ repo_id: "r1", paths: ["docs/a.md", "docs/b.md"] });
    });
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      // Synchronously aborts the first request's controller (its signal is
      // now `aborted`, but — per `autoRejectOnAbort: false` — its promise
      // stays pending rather than settling).
      result.current.mutate({ repo_id: "r1", paths: ["docs/b.md"] });
    });
    await waitFor(() => expect(calls).toHaveLength(2));

    // The second (superseding) request resolves first.
    act(() => {
      calls[1]!.resolve([{ path: "docs/b.md", order: 0 }]);
    });
    await waitFor(() => {
      expect(qc.getQueryData(listKey)).toEqual([{ path: "docs/b.md", order: 0 }]);
    });

    // The first (superseded) request's response now arrives — resolving
    // normally, not rejecting, despite its controller having been aborted.
    // `mutationFn`'s `SUPERSEDED` branch only fires on rejection, so this
    // result reaches `onSuccess` as ordinary data; only its stale `seq`
    // stands between it and clobbering the cache. Deleting the
    // `result.seq !== seq.current` guard makes this line overwrite the
    // cache with the stale `[a, b]` array below, failing the next
    // assertion.
    act(() => {
      calls[0]!.resolve([
        { path: "docs/a.md", order: 0 },
        { path: "docs/b.md", order: 1 },
      ]);
    });

    // The resolution above still has to travel through `apiFetch`'s own
    // `await res.json()` hop and `mutationFn`'s `await api.put(...)` before
    // it ever reaches `onSuccess` — the cache is *already* correct at this
    // point (from the second request, above), so a `waitFor` that only
    // polls until its assertion is truthy could pass on its very first,
    // premature check and never actually observe a clobber. A real
    // macrotask flush guarantees every microtask this chain schedules has
    // run before the check below, regardless of which way it comes out.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(qc.getQueryData(listKey)).toEqual([{ path: "docs/b.md", order: 0 }]);
    });
    // A cancellation is not a failure — it must never surface as a mutation error.
    expect(result.current.isError).toBe(false);
  });

  it("does not roll back to a phantom, server-unconfirmed state after a supersede-then-fail sequence (PR1)", async () => {
    const { fetchMock, calls } = mockFetchQueue();
    vi.stubGlobal("fetch", fetchMock);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const listKey = ["agent-context-docs", "ag1", "r1"];
    qc.setQueryData(listKey, []); // the server-confirmed starting point

    const { result } = renderHook(() => useSetAgentContextDocs("ag1"), {
      wrapper: wrapperFor(qc),
    });

    // Tick A: attach X. Its optimistic write lands in the cache, but its own
    // PUT is about to be superseded — it will never be confirmed.
    act(() => {
      result.current.mutate({ repo_id: "r1", paths: ["docs/x.md"] });
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(qc.getQueryData(listKey)).toEqual([{ path: "docs/x.md", order: 0 }]);

    // Tick B: attach Y before A resolves. B's `onMutate` snapshots A's
    // still-unconfirmed optimistic write as its own `previous` — the
    // phantom-rollback risk this test guards against.
    act(() => {
      result.current.mutate({ repo_id: "r1", paths: ["docs/x.md", "docs/y.md"] });
    });
    await waitFor(() => expect(calls).toHaveLength(2));

    // B's own PUT then genuinely fails.
    act(() => {
      calls[1]!.reject(new Error("boom"));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // The rollback must NOT restore `[X]` — that value was only ever A's
    // unconfirmed optimistic write; A was silently superseded and the
    // server never actually applied it.
    expect(qc.getQueryData(listKey)).not.toEqual([{ path: "docs/x.md", order: 0 }]);
    // Instead of trusting that snapshot, the failed mutation invalidates the
    // list key so an active observer would refetch the server's real state.
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("restores the pre-mutation cache value when a PUT genuinely fails (R2)", async () => {
    const { fetchMock, calls } = mockFetchQueue();
    vi.stubGlobal("fetch", fetchMock);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const listKey = ["skill-context-docs", "sk1", "r1"];
    const previous = [{ path: "docs/a.md", order: 0 }];
    qc.setQueryData(listKey, previous);

    const { result } = renderHook(() => useSetSkillContextDocs("sk1"), {
      wrapper: wrapperFor(qc),
    });

    act(() => {
      result.current.mutate({ repo_id: "r1", paths: [] });
    });
    await waitFor(() => expect(calls).toHaveLength(1));

    // Optimistic apply already landed before the request settles.
    expect(qc.getQueryData(listKey)).toEqual([]);

    act(() => {
      calls[0]!.reject(new Error("boom"));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(listKey)).toEqual(previous);
  });
});
