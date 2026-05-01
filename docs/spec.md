# AgentRig Registry Spec

The registry is the public signed installability boundary for AgentRig
artifacts. A directory entry is not installable until `registry.json` includes a
non-blocked item for that artifact and the referenced version snapshot validates.

## Artifact Kinds

Registry items use one canonical kind axis:

- `plugin`
- `skill`
- `mcp`
- `hook`

Future SDK/web/CLI surfaces may add `command` and `agent`, but this registry
validator currently accepts installable standalone layouts for plugins, skills,
MCPs, and hooks.

`registry.json.items[].kind` selects the artifact kind. Plugin rows keep the
legacy `plugin` field as a compatibility alias; all rows use `artifact` as the
canonical id.

## Layout

```text
plugins/<namespace>/<plugin>/plugin.json
skills/<namespace>/<skill>/skill.json
mcps/<namespace>/<mcp>/mcp.json
hooks/<namespace>/<hook>/hook.json

<kind-root>/<namespace>/<artifact>/versions/<version>/
```

Each version directory contains the manifest, provenance, lock, review, README,
and license files:

```text
.plugin/plugin.json
.skill/skill.json
.mcp/mcp.json
.hook/hook.json
AGENTRIG_SOURCE.json
AGENTRIG_LOCK.json
AGENTRIG_REVIEW.json
README.md
LICENSE
```

Standalone source artifacts use `artifact_kind` and `artifact_path`. Plugin
source artifacts use `plugin_path`. The two shapes are mutually exclusive.

Standalone locks use `artifact_kind` and `artifact_id`. Plugin locks use the
legacy `plugin` field. The two lock shapes are mutually exclusive.

## Trust And Installability

Installability is explicit:

- `official` and `reviewed` may be `installable`.
- `listed` is `discovery_only`.
- `blocked` and `yanked` always win.

No web directory row, local repo scan, discovery submission, profile ownership,
or AI enrichment draft can make an artifact installable. The signed registry
item is the only install authority.

## Bundled Artifacts

Skills, MCPs, and hooks bundled inside plugins are discovered from plugin locks
by `@agentrig/sdk`. They inherit the parent plugin's registry trust and
installability unless and until they have their own standalone signed registry
entry.

Local selected-artifact installs are represented as AgentRig Selection Bundles. The
registry records source trust; the SDK and CLI handle closure checks,
materialization metadata, and hash-owned uninstall ledger records.

## Validation

```bash
node scripts/validate-registry.mjs --check
```

The validator checks registry item kind/id consistency, version history paths,
manifest shapes, source/lock mutual exclusion, referenced standalone entry files,
review artifacts, and derived registry output.
