---
name: arig-adapter-shared-extraction
description: Extract repeated adapter, provider, exporter, installer, driver, or backend patterns into shared abstractions without over-generalizing. Use when multiple sibling files implement the same workflow with small variations and the code would benefit from a shared orchestrator, shared context types, shared helper utilities, or clearer local-vs-shared boundaries.
---

# Adapter Shared Extraction

Refactor repeated sibling implementations into a cleaner split between shared orchestration and local behavior. Keep invariants in shared modules and keep semantics that differ by provider, backend, or adapter in local files.

Read `references/heuristics.md` before doing a large extraction.

## Workflow

1. Compare the sibling files side by side.
2. Separate invariant steps from provider-specific behavior.
3. Extract only the repeated parts with the same reason to change.
4. Keep distinct manifest builders, policies, and side effects local if they differ semantically.
5. Re-run typecheck and focused tests after the split.

## Good Shared Candidates

- shared context types
- provider registries
- orchestrator functions
- copy or normalization helpers
- parsing helpers
- common validation logic
- output formatting helpers

## Good Local Candidates

- provider-specific manifests
- backend-specific install behavior
- semantic differences in policy
- provider-only file layouts
- legacy compatibility commands

## Extraction Rules

- Extract only when the pattern appears in at least two real siblings and is likely to keep evolving together.
- Prefer one thin orchestrator plus small local adapters over one giant shared file.
- Prefer explicit context objects over long parameter lists.
- Stop extracting when the abstraction starts hiding meaning.

## Verification

- Check that each provider or adapter file got smaller and clearer.
- Check that the shared layer only contains true invariants.
- Confirm the public command or API surface still reads naturally.
- Run focused tests that touch the extracted flow.
