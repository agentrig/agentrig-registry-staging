# AgentRig Registry Staging

`agentrig-registry-staging` is the public staging registry for AgentRig marketplace artifacts.

This repository intentionally starts empty: it contains the registry contract, schemas, validation scripts, and placeholder artifact roots so promotion tooling can open pull requests against a clean staging target. Do not copy production marketplace entries or QA submissions here unless a PR explicitly introduces a staging-safe fixture.

## Public Entrypoints

- Registry index: `https://raw.githubusercontent.com/agentrig/agentrig-registry-staging/main/registry.json`
- Raw base URL: `https://raw.githubusercontent.com/agentrig/agentrig-registry-staging/main/`

Recommended staging environment:

```bash
REGISTRY_ENVIRONMENT=staging
REGISTRY_PROMOTION_REPO=agentrig/agentrig-registry-staging
REGISTRY_PROMOTION_BRANCH=main
REGISTRY_UPSTREAM_BASE_URL=https://raw.githubusercontent.com/agentrig/agentrig-registry-staging/main/
```

## Layout

- `registry.json` - top-level staging registry index
- `advisories.json` - staging advisories, empty until fixtures or submissions need them
- `plugins/`, `skills/`, `mcps/`, `hooks/` - artifact roots
- `schemas/` - registry JSON schemas
- `scripts/validate-registry.mjs` - canonical validation and sync script

## Validate

```bash
REGISTRY_ENVIRONMENT=staging node scripts/validate-registry-production-policy.test.mjs
REGISTRY_ENVIRONMENT=staging node scripts/validate-registry.mjs --check
```

To refresh derived JSON after a staging PR changes artifact snapshots:

```bash
REGISTRY_ENVIRONMENT=staging node scripts/validate-registry.mjs --write
```
