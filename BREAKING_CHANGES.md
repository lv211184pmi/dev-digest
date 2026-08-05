# Breaking Changes - API Contract Updates

This document describes the breaking changes introduced to the `RepoIntel` public API.

## Overview

This PR introduces several breaking changes to the `RepoIntel` interface for testing purposes. These changes include method removals, signature modifications, and return type changes.

## Breaking Changes

### 1. `getBlastRadius` - Signature Change ⚠️

**Before:**
```typescript
getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>
```

**After:**
```typescript
getBlastRadius(repoId: string, changedFiles: string[], includeTests: boolean): Promise<BlastResult>
```

**Impact:** All callers must now provide the `includeTests` parameter.

**Migration:**
```typescript
// Old code
await repoIntel.getBlastRadius(repoId, files);

// New code
await repoIntel.getBlastRadius(repoId, files, true); // or false
```

---

### 2. `getRepoMap` - Return Type Change ⚠️

**Before:**
```typescript
getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>
```

**After:**
```typescript
getRepoMap(repoId: string, tokenBudget?: number): Promise<{
  result: RepoMapResult;
  generatedAt: Date;
}>
```

**Impact:** The method now returns an object containing the result and a timestamp.

**Migration:**
```typescript
// Old code
const repoMap = await repoIntel.getRepoMap(repoId);
console.log(repoMap.text);

// New code
const { result, generatedAt } = await repoIntel.getRepoMap(repoId);
console.log(result.text);
console.log('Generated at:', generatedAt);
```

---

### 3. `getUnresolvedReferences` - Method Removed 🗑️

**Status:** REMOVED

**Replacement:** Use `getSymbolsInFiles` instead

**Migration:**
```typescript
// Old code (no longer works)
const refs = await repoIntel.getUnresolvedReferences(repoId, files);

// New code - use getSymbolsInFiles
const symbols = await repoIntel.getSymbolsInFiles(repoId, files);
// Filter for unresolved symbols as needed
```

---

### 4. `getConventionSamples` - Method Removed 🗑️

**Status:** REMOVED

**Replacement:** Use `getTopFilesByRank` instead

**Migration:**
```typescript
// Old code (no longer works)
const samples = await repoIntel.getConventionSamples(repoId, 10);

// New code - use getTopFilesByRank
const samples = await repoIntel.getTopFilesByRank(repoId, 10);
```

---

## Affected Files

The following files in the codebase currently use these APIs and will need updates:

- `server/src/modules/reviews/run-executor.ts`
- `server/test/repo-intel-facade-degraded.test.ts`
- `server/test/indexer-pipeline.test.ts`

## Testing

To test the impact of these changes:

1. Run the type checker: `cd server && pnpm typecheck`
2. Run the test suite: `cd server && pnpm test`

Expected: TypeScript errors and test failures in files that use the modified APIs.

## Rollback

To revert these changes, checkout the `main` branch:

```bash
git checkout main
```

## Questions?

This is a test PR candidate. The changes are intentionally breaking for testing purposes.
