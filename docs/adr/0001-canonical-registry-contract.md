# ADR 0001: Canonical Registry Contract

## Status

Accepted.

## Decision

AgentRig has exactly one canonical public installability contract.

Publicly installable software must come from a registry that is:

- static
- git-mirrorable
- signed
- immutable at the version level

The authoritative source repository for the public world is `agentrig-registry`.

Mirrors and CDNs may redistribute exact bytes from a signed registry state, but they are never independent truth sources.

## Canonical Identity

The canonical artifact identity is `namespace.artifact`.

Registry rows carry a required `kind`:

- `plugin`
- `skill`
- `mcp`
- `hook`

Rules:

- `namespace` uses lowercase letters, numbers, and hyphens
- `artifact` uses lowercase letters, numbers, and hyphens
- exactly one `.` separates namespace and artifact
- versions use SemVer

Canonical install refs use:

`<registryAlias>/<namespace.artifact>@<version>`

Canonical registry paths use:

`plugins/<namespace>/<plugin>/versions/<version>/`
`skills/<namespace>/<skill>/versions/<version>/`
`mcps/<namespace>/<mcp>/versions/<version>/`
`hooks/<namespace>/<hook>/versions/<version>/`

The per-artifact history document lives at:

`plugins/<namespace>/<plugin>/plugin.json`
`skills/<namespace>/<skill>/skill.json`
`mcps/<namespace>/<mcp>/mcp.json`
`hooks/<namespace>/<hook>/hook.json`

Plugin rows keep the legacy `plugin` field as an alias for `artifact`. Standalone artifact rows
must not carry that alias.

## Installable Sources

Installable:

- static signed registries that implement this contract

Not installable:

- Convex-hosted bytes
- direct author repositories
- direct GitHub URLs or repo refs
- ZIP uploads
- arbitrary HTTPS manifest URLs
- directory-only entries
- community upload buckets

These sources may still appear in discovery or submission workflows, but they never imply install trust.

Direct repo reuse is an external-repo workflow. `agentrig inspect` and `agentrig use`
may scan and install selected files locally with SHA-pinned source provenance, but the
resulting install record is not a registry identity and must not be represented as one.

## Trust Contract

The only valid trust tiers are:

- `official`
- `reviewed`
- `listed`
- `blocked`
- `yanked`

Operational meaning:

- `official`: installable
- `reviewed`: installable
- `listed`: discovery-only, not installable
- `blocked`: not installable and hard-blocked
- `yanked`: not available for new installs, retained only for historical and advisory use

`verified-author` is not a trust tier.

`verified-author` is identity or ownership metadata only.

Derived installability state is:

- `official` -> `installable`
- `reviewed` -> `installable`
- `listed` -> `discovery_only`
- `blocked` -> `blocked`
- `yanked` -> `yanked`

## Submission Contract

The canonical plugin submission input is:

- `upstream_repo`
- `upstream_tag`
- `upstream_commit_sha`
- `plugin_path`

Standalone artifact submissions replace `plugin_path` with `artifact_kind` and `artifact_path`.

Required invariants:

- `upstream_tag` must resolve to `upstream_commit_sha`
- `plugin_path` is relative to the upstream repository root
- branches are forbidden
- `latest` is forbidden
- unpinned refs are forbidden

Submission is a review primitive only. Submission never makes bytes installable by itself.

Discovery submissions created from deterministic repo scans are also review primitives only.
They may include `scanId`, selected signal paths, source repo, commit, and digest metadata,
but they cannot enter registry promotion until converted into a canonical submission with
the four pinned inputs above.

AI-enriched fields are draft metadata. They may help admins fill descriptions, keywords,
or suggested ids, but they do not affect scan digests, picked files, registry source
artifacts, trust tiers, installability, or signature inputs until a human accepts them and
the final canonical registry artifacts are generated from the version tree.

## Required Registry Artifacts

Registry-wide:

- `registry.json`
- `advisories.json`

Per artifact:

- `plugins/<namespace>/<plugin>/plugin.json`
- `skills/<namespace>/<skill>/skill.json`
- `mcps/<namespace>/<mcp>/mcp.json`
- `hooks/<namespace>/<hook>/hook.json`

Per version:

- `.plugin/plugin.json`
- or `.skill/skill.json`, `.mcp/mcp.json`, `.hook/hook.json`
- `AGENTRIG_SOURCE.json`
- `AGENTRIG_LOCK.json`
- `AGENTRIG_REVIEW.json`

Minimum required contents:

### `AGENTRIG_SOURCE.json`

- `upstream_repo`
- `upstream_tag`
- `upstream_commit`
- `plugin_path` for plugins
- `artifact_kind` and `artifact_path` for standalone artifacts
- `submitted_by`
- `snapshot_created_at`
- `snapshot_tree_digest`

Submission input uses `upstream_commit_sha`. That value maps directly to
`upstream_commit` in `AGENTRIG_SOURCE.json`.

### `AGENTRIG_LOCK.json`

- `plugin` for plugin locks
- `artifact_kind` and `artifact_id` for standalone artifact locks
- `version`
- `file_digests`
- `capability_set`
- `declared_network_domains`
- `declared_secrets`
- `runtime_requirements`
- `dependencies`
- `snapshot_digest`

### `AGENTRIG_REVIEW.json`

- `review_status`
- `reviewer`
- `reviewed_at`
- `scanner_summary`
- `policy_decisions`
- `trust_tier_basis`

### `advisories.json`

The root document contains:

- `$schema`
- `generated_at`
- `items`

Each item in `items` contains:

- `id`
- `title`
- `published_at`
- `plugin`
- `affected_versions`
- `severity`
- `advisory_type`
- `remediation`
- `blocked`
- `yanked`

## Signature And Digest Contract

The following is frozen by contract:

- `registry.json` must be signed
- the signature envelope lives inside `registry.json` at the `signature` property
- `registry.json.signature.target` is always `registry.json`
- `registry.json.signature.signed_digest` is computed from the canonical unsigned registry payload
- plugin versions must be addressable by digest
- the CLI must never trust mutable registry JSON without verification
- mirrors and CDNs may only serve exact byte mirrors of signed registry states

The concrete publish-time signing service is follow-up work. The repository contract already fixes the signed artifact, the signature location, and the deterministic digest that CI must verify.

## Deterministic Derivation

`registry.json` and every per-artifact history document are derived from the canonical version tree plus `advisories.json`.

The repository maintains one deterministic command path:

- `node scripts/validate-registry.mjs --write`
- `node scripts/validate-registry.mjs --check`

That command path is responsible for:

- synchronizing per-version digest fields in `AGENTRIG_SOURCE.json` and `AGENTRIG_LOCK.json`
- regenerating artifact history documents
- regenerating `registry.json`
- proving that committed JSON has no drift from the tree

## Discovery Versus Installability

Discovery and installability are separate contracts.

Discovery may:

- show external repositories
- show `listed` projects
- link upstream sources
- offer "submit for review"
- show deterministic scan results and selected signal paths
- show AI-enriched draft metadata after admin review

Discovery must not:

- render the same install CTA as `official` or `reviewed`
- imply installability
- derive code trust from profile or directory metadata
- treat `agentrig use <repo>` local installs as registry installs
- copy AI-enriched fields into registry artifacts without human acceptance

## Validation Rules

Consumers and producers must enforce these invariants:

1. Only canonical artifact ids matching `namespace.artifact` are valid.
2. Only canonical install refs matching `<registryAlias>/<namespace.artifact>@<version>` are valid.
3. Only canonical registry paths under `plugins/`, `skills/`, `mcps/`, or `hooks/` are valid.
4. Only canonical trust tiers are valid.
5. Only static signed registries are installable.
6. Submission inputs must be repo, tag, full commit SHA, and a canonical plugin or artifact path.
7. Every published version must carry source, lock, and review artifacts.
8. Every published version must be digest-addressable.
9. Directory or discovery metadata must never be used as install trust.
10. `verified-author` and similar identity markers must stay orthogonal to install trust.
11. External-repo install records must stay separate from verified registry install records.
12. AI enrichment must remain draft-only until human acceptance and canonical artifact generation.

## Terminology Cleanup

These phrases are not canonical and must not be used as install contract language:

- "hosted community registry" as an install source
- "install from a ZIP upload"
- "install from direct URL"
- "install from author repo"
- "`listed` means installable"
- "`verified-author` is a trust tier"
- "Convex is the public artifact source"
- "AI reviewed means installable"
- "external repo install is registry install"

## Consequences

- later CLI, Convex, and bot work must implement this contract exactly
- compatibility with old draft shapes is intentionally out of scope
- old shapes should be deleted or rewritten, not adapted
