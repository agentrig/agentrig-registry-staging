---
name: arig-code-review-low
description: Lightweight code review for pull requests, patches, diffs, or change summaries with focus limited to code smells, security, performance, and whether new or regression tests are needed. Use when the user wants a narrow, faster review instead of a full correctness audit, especially for PR review, patch review, CI triage, or quick-review requests.
---

# Code Review Low

Review only these categories:
- code smells
- security
- performance
- tests needed

Ignore style, naming, product feedback, and broad architecture opinions unless they create a concrete issue inside one of those four categories.

## Gather Inputs

Prefer these artifacts when available:
- change summary
- diff and touched files
- CI logs and coverage summary
- environment, API schemas, DB migrations, dependency changes

If an artifact is missing, continue with the available evidence. State the missing input and the risk it hides.

## Review Workflow

1. Build the change model.
   - Summarize what changed.
   - Mark risky surfaces: auth, validation, persistence, migrations, concurrency, caching, networking, hot paths, public APIs.
2. Review code smells.
   - Check for duplication, long methods, deep nesting, dead code, unused imports, leaky abstractions, tight coupling, improper layering.
   - Check edge cases: null, empty input, timezones, encodings, retries, idempotency, concurrency.
3. Review security.
   - Check secret handling, input validation, output encoding, injection paths, AuthN/AuthZ, tenant isolation, path traversal, SSRF, XXE, unsafe upload handling.
   - Check crypto or transport choices, TLS verification, CORS or header regressions, dependency or supply-chain risk when dependencies changed.
4. Review performance.
   - Check asymptotic regressions, hot-path allocations, blocking I/O, query shape, missing indexes, full scans, cache correctness, chatty network calls, timeout or backoff gaps.
   - For UI changes, check bundle size impact and critical render-path work when evidence exists.
5. Review tests needed.
   - Decide whether unit, integration, or end-to-end coverage is needed for the new behavior.
   - Call out missing edge-case, negative-case, concurrency, or time-based tests.
   - Prefer the smallest regression test set that would guard the change.

## Findings Bar

Report only concrete, actionable issues.

Use these severities:
- `blocker`: must fix before merge; exploitable security issue, major regression risk, or critical missing coverage on a risky path
- `high`: serious issue with likely production impact
- `medium`: meaningful weakness or maintainability/perf risk
- `low`: worthwhile improvement with limited blast radius

If no actionable issues exist, say so explicitly.

## Output

Use this structure:

- `Summary`: what changed, top 1-3 risks, `Decision: approve | request_changes | blocker`
- `Findings` grouped by `Smell | Security | Performance | Tests`
- For each finding:
  - `[severity] <title>`
  - `Where: <file:line-range>`
  - `Impact: <who/what is affected>`
  - `Recommendation: <smallest safe fix>`
  - `Tests: <tests to add/update>`

## Constraints

- Cite exact files and line ranges.
- Keep code excerpts at or below 20 lines total per excerpt.
- Give pseudocode or patch outlines only. Do not write full implementations.
- If confidence is limited by missing data, state the assumption and resulting risk.
