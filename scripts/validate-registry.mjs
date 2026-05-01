#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REGISTRY_SCHEMA_URL = 'https://agentrig.ai/schema/registry.json'
const PLUGIN_SCHEMA_URL = 'https://agentrig.ai/schema/plugin.v1.json'
const STANDALONE_MANIFEST_SCHEMA_URLS = {
  skill: 'https://agentrig.ai/schema/skill.v1.json',
  mcp: 'https://agentrig.ai/schema/mcp.v1.json',
  hook: 'https://agentrig.ai/schema/hook.v1.json',
}
const PLUGIN_HISTORY_SCHEMA_URL = 'https://agentrig.ai/schema/plugin-history.json'
const ADVISORIES_SCHEMA_URL = 'https://agentrig.ai/schema/advisories.json'
const SOURCE_SCHEMA_URL = 'https://agentrig.ai/schema/agentrig-source.json'
const LOCK_SCHEMA_URL = 'https://agentrig.ai/schema/agentrig-lock.json'
const REVIEW_SCHEMA_URL = 'https://agentrig.ai/schema/agentrig-review.json'

const REGISTRY_ALIAS = 'agentrig'
const SOURCE_REPOSITORY = 'https://github.com/agentrig/agentrig-registry-staging'
const SIGNATURE_ALGORITHM = 'sha256-json-envelope'
const SIGNATURE_KEY_ID = 'agentrig-registry-staging'
const SIGNATURE_TARGET = 'registry.json'
const REGISTRY_ENVIRONMENTS = new Set(['production', 'staging', 'dev'])

const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const FULL_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/
const RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/).+$/

const TRUST_TIER_TO_INSTALLABILITY = {
  official: 'installable',
  reviewed: 'installable',
  listed: 'discovery_only',
  blocked: 'blocked',
  yanked: 'yanked',
}

const VALID_TRUST_TIERS = new Set(Object.keys(TRUST_TIER_TO_INSTALLABILITY))
const VALID_INSTALLABILITY_STATES = new Set(Object.values(TRUST_TIER_TO_INSTALLABILITY))
const VALID_REVIEW_STATUS = new Set(['pending', 'approved', 'rejected', 'blocked', 'yanked'])
const VALID_SCANNER_STATUS = new Set(['pass', 'warn', 'fail'])
const VALID_ADVISORY_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const VALID_ADVISORY_TYPES = new Set(['security', 'integrity', 'policy', 'malware', 'legal', 'deprecation', 'other'])
const VALID_ARTIFACT_KINDS = new Set(['plugin', 'skill', 'mcp', 'hook'])
const STANDALONE_ARTIFACT_LAYOUTS = [
  {
    kind: 'skill',
    root: 'skills',
    historyFile: 'skill.json',
    manifestDir: '.skill',
    manifestFile: 'skill.json',
    manifestField: 'entry',
  },
  {
    kind: 'mcp',
    root: 'mcps',
    historyFile: 'mcp.json',
    manifestDir: '.mcp',
    manifestFile: 'mcp.json',
    manifestField: 'config',
  },
  {
    kind: 'hook',
    root: 'hooks',
    historyFile: 'hook.json',
    manifestDir: '.hook',
    manifestFile: 'hook.json',
    manifestField: 'config',
  },
]

const ROOT_ALLOWED_ENTRIES = new Set([
  '.github',
  'LICENSE',
  'README.md',
  'advisories.json',
  'docs',
  'hooks',
  'mcps',
  'plugins',
  'registry.json',
  'schemas',
  'scripts',
  'skills',
])

const REQUIRED_VERSION_FILES = new Set([
  'AGENTRIG_LOCK.json',
  'AGENTRIG_REVIEW.json',
  'AGENTRIG_SOURCE.json',
  'LICENSE',
  'README.md',
])
const BLOCKED_DELIVERY_EXTENSIONS = ['.tgz', '.tar.gz', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar']
const BLOCKED_DELIVERY_NAME_PATTERNS = [
  /^checksums?(\.[a-z0-9]+)?$/i,
  /^artifacts?$/i,
  /^bundle$/i,
  /^dist$/i,
  /^release$/i,
  /^build$/i,
  /^out$/i,
  /^coverage$/i,
  /^node_modules$/i,
  /^\.next$/i,
  /^\.turbo$/i,
  /^\.cache$/i,
]
const DIGEST_EXCLUDED_RELATIVE_PATHS = new Set([
  'AGENTRIG_LOCK.json',
  'AGENTRIG_REVIEW.json',
  'AGENTRIG_SOURCE.json',
])
const VERSION_RECORD_FIELDS = ['version', 'path', 'manifest', 'source', 'lock', 'review', 'trust_tier', 'installability', 'snapshot_digest', 'published_at']
const SKELETON_KEEP_FILE = '.gitkeep'

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function assertPlainObject(value, where) {
  assert(isPlainObject(value), `Invalid ${where}: expected an object`)
}

function assertString(value, where) {
  assert(typeof value === 'string' && value.trim(), `Invalid ${where}: expected a non-empty string`)
}

function assertOptionalString(value, where) {
  assert(value === undefined || (typeof value === 'string' && value.trim()), `Invalid ${where}: expected an omitted or non-empty string`)
}

function assertArray(value, where) {
  assert(Array.isArray(value), `Invalid ${where}: expected an array`)
}

function assertBoolean(value, where) {
  assert(typeof value === 'boolean', `Invalid ${where}: expected a boolean`)
}

function assertSetMember(value, allowed, where) {
  assert(allowed.has(value), `Invalid ${where}: got "${value}"`)
}

function assertPattern(value, pattern, where) {
  assert(pattern.test(value), `Invalid ${where}: got "${value}"`)
}

function registryEnvironment() {
  const environment = (process.env.REGISTRY_ENVIRONMENT || 'production').trim()
  assertSetMember(environment, REGISTRY_ENVIRONMENTS, 'REGISTRY_ENVIRONMENT')
  return environment
}

function isProductionTestArtifactId(artifactId) {
  const [namespace, artifactName] = artifactId.split('.')
  return (
    /^test-/.test(namespace) ||
    /^qa-/.test(namespace) ||
    /^test-/.test(artifactName) ||
    /^qa-/.test(artifactName) ||
    artifactId.startsWith('regenrek.test-')
  )
}

function assertProductionArtifactAllowed(artifactId, where) {
  if (registryEnvironment() !== 'production') return
  assert(
    !isProductionTestArtifactId(artifactId),
    `Invalid ${where}: production registry rejects test/QA artifact "${artifactId}"`,
  )
}

function assertUri(value, where) {
  assertString(value, where)
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`Invalid ${where}: expected a valid URI`)
  }
  assert(parsed.protocol === 'http:' || parsed.protocol === 'https:', `Invalid ${where}: expected an http/https URI`)
}

function assertDateTime(value, where) {
  assertString(value, where)
  const parsed = Date.parse(value)
  assert(Number.isFinite(parsed), `Invalid ${where}: expected an ISO date-time string`)
}

function assertAdditionalProperties(value, allowedKeys, where) {
  for (const key of Object.keys(value)) {
    assert(allowedKeys.has(key), `Invalid ${where}: unexpected field "${key}"`)
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join(path.posix.sep)
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortKeys(child)]),
    )
  }
  return value
}

function stableJson(value) {
  return JSON.stringify(sortKeys(value))
}

function stableJsonPretty(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, stableJsonPretty(value))
}

async function ensureRegularFile(filePath, label) {
  let stat
  try {
    stat = await fs.lstat(filePath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      fail(`Missing required file: ${label}`)
    }
    throw error
  }
  assert(!stat.isSymbolicLink(), `${label} must be a regular file, not a symlink`)
  assert(stat.isFile(), `${label} must be a regular file`)
}

async function ensureDirectory(dirPath, label) {
  const stat = await fs.lstat(dirPath)
  assert(!stat.isSymbolicLink(), `${label} must be a directory, not a symlink`)
  assert(stat.isDirectory(), `${label} must be a directory`)
}

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function parseSemver(version) {
  const match = version.match(SEMVER_PATTERN)
  assert(match, `Invalid semver: ${version}`)
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareSemverIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number.parseInt(left, 10) - Number.parseInt(right, 10)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left.localeCompare(right)
}

function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    const comparison = compareSemverIdentifiers(leftPart, rightPart)
    if (comparison !== 0) return comparison
  }
  return 0
}

function sha256Hex(input) {
  const hash = createHash('sha256')
  hash.update(input)
  return `sha256:${hash.digest('hex')}`
}

function digestObject(value) {
  return sha256Hex(stableJson(value))
}

function mapInstallability(trustTier) {
  const installability = TRUST_TIER_TO_INSTALLABILITY[trustTier]
  assert(installability, `Unsupported trust tier "${trustTier}"`)
  return installability
}

function maybeArray(value) {
  return Array.isArray(value) && value.length ? value : undefined
}

function isDeliveryArtifact(name) {
  const lower = name.toLowerCase()
  if (BLOCKED_DELIVERY_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true
  if (BLOCKED_DELIVERY_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true
  return false
}

async function listEntries(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.sort((left, right) => left.name.localeCompare(right.name))
}

async function listPayloadFiles(versionDir, relativeDir = '') {
  const targetDir = relativeDir ? path.join(versionDir, relativeDir) : versionDir
  const entries = await listEntries(targetDir)
  const files = []

  for (const entry of entries) {
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name
    const absolutePath = path.join(versionDir, relativePath)
    const posixPath = toPosix(relativePath)

    if (entry.isSymbolicLink()) {
      fail(`Invalid ${versionDir}: symbolic links are forbidden (found ${posixPath})`)
    }

    if (isDeliveryArtifact(entry.name)) {
      fail(`Invalid ${versionDir}: delivery artifact "${posixPath}" is forbidden`)
    }

    if (entry.isDirectory()) {
      files.push(...(await listPayloadFiles(versionDir, relativePath)))
      continue
    }

    if (!entry.isFile()) {
      fail(`Invalid ${versionDir}: unsupported filesystem entry "${posixPath}"`)
    }

    if (DIGEST_EXCLUDED_RELATIVE_PATHS.has(posixPath)) {
      continue
    }

    files.push({ absolutePath, relativePath: posixPath })
  }

  return files
}

async function computeVersionDigests(versionDir) {
  const files = await listPayloadFiles(versionDir)
  const fileDigests = []

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath)
    fileDigests.push({
      path: file.relativePath,
      digest: sha256Hex(content),
    })
  }

  fileDigests.sort((left, right) => left.path.localeCompare(right.path))
  const snapshotDigest = digestObject(fileDigests)
  return { fileDigests, snapshotDigest }
}

function validateStringArray(items, where) {
  assertArray(items, where)
  for (let index = 0; index < items.length; index += 1) {
    assertString(items[index], `${where}[${index}]`)
  }
}

function validateFileDigests(fileDigests, where) {
  assertArray(fileDigests, where)
  const seenPaths = new Set()
  let lastPath = null
  for (let index = 0; index < fileDigests.length; index += 1) {
    const item = fileDigests[index]
    const itemWhere = `${where}[${index}]`
    assertPlainObject(item, itemWhere)
    assertAdditionalProperties(item, new Set(['path', 'digest']), itemWhere)
    assertString(item.path, `${itemWhere}.path`)
    assertPattern(item.path, RELATIVE_PATH_PATTERN, `${itemWhere}.path`)
    assertPattern(item.digest, SHA256_PATTERN, `${itemWhere}.digest`)
    assert(!DIGEST_EXCLUDED_RELATIVE_PATHS.has(item.path), `Invalid ${itemWhere}.path: ${item.path} is derived and must not be digest-addressed`)
    assert(!seenPaths.has(item.path), `Invalid ${where}: duplicate digest path "${item.path}"`)
    if (lastPath != null) {
      assert(lastPath.localeCompare(item.path) < 0, `Invalid ${where}: file_digests must be sorted by path`)
    }
    seenPaths.add(item.path)
    lastPath = item.path
  }
}

function validatePluginManifest(manifest, pluginId, version, where) {
  assertPlainObject(manifest, where)
  assertAdditionalProperties(
    manifest,
    new Set(['$schema', 'kind', 'id', 'name', 'description', 'version', 'author', 'license', 'keywords', 'pluginDependencies', 'configSchema', 'x-agentrig']),
    where,
  )
  if ('$schema' in manifest) {
    assert(manifest.$schema === PLUGIN_SCHEMA_URL, `Invalid ${where}.$schema: expected "${PLUGIN_SCHEMA_URL}"`)
  }
  assert(manifest.kind === 'agentrig:plugin', `Invalid ${where}.kind: expected "agentrig:plugin"`)
  assert(manifest.id === pluginId, `Invalid ${where}.id: expected "${pluginId}"`)
  assert(manifest.version === version, `Invalid ${where}.version: expected "${version}"`)
  assertString(manifest.name, `${where}.name`)
  assertString(manifest.description, `${where}.description`)
  assertOptionalString(manifest.author, `${where}.author`)
  assertOptionalString(manifest.license, `${where}.license`)
  assertPattern(manifest.id, PLUGIN_ID_PATTERN, `${where}.id`)
  assertPattern(manifest.version, SEMVER_PATTERN, `${where}.version`)

  if ('keywords' in manifest) validateStringArray(manifest.keywords, `${where}.keywords`)

  if ('pluginDependencies' in manifest) {
    validateStringArray(manifest.pluginDependencies, `${where}.pluginDependencies`)
    for (let index = 0; index < manifest.pluginDependencies.length; index += 1) {
      assertPattern(manifest.pluginDependencies[index], PLUGIN_ID_PATTERN, `${where}.pluginDependencies[${index}]`)
    }
  }

  assertPlainObject(manifest.configSchema, `${where}.configSchema`)

  if ('x-agentrig' in manifest) {
    assertPlainObject(manifest['x-agentrig'], `${where}.x-agentrig`)
  }
}

function assertArtifactKind(value, where) {
  assertSetMember(value, VALID_ARTIFACT_KINDS, where)
}

function validateStandaloneManifest(manifest, layout, artifactId, version, where) {
  assertPlainObject(manifest, where)
  assertAdditionalProperties(
    manifest,
    new Set([
      '$schema',
      'kind',
      'id',
      'name',
      'description',
      'version',
      'author',
      'license',
      'keywords',
      'capability_set',
      'declared_network_domains',
      'declared_secrets',
      'runtime_requirements',
      layout.manifestField,
    ]),
    where,
  )
  if ('$schema' in manifest) {
    assert(manifest.$schema === STANDALONE_MANIFEST_SCHEMA_URLS[layout.kind], `Invalid ${where}.$schema: expected "${STANDALONE_MANIFEST_SCHEMA_URLS[layout.kind]}"`)
  }
  assert(manifest.kind === `agentrig:${layout.kind}`, `Invalid ${where}.kind: expected "agentrig:${layout.kind}"`)
  assert(manifest.id === artifactId, `Invalid ${where}.id: expected "${artifactId}"`)
  assert(manifest.version === version, `Invalid ${where}.version: expected "${version}"`)
  assertString(manifest.name, `${where}.name`)
  assertString(manifest.description, `${where}.description`)
  assertOptionalString(manifest.author, `${where}.author`)
  assertOptionalString(manifest.license, `${where}.license`)
  assertPattern(manifest.id, PLUGIN_ID_PATTERN, `${where}.id`)
  assertPattern(manifest.version, SEMVER_PATTERN, `${where}.version`)

  if ('keywords' in manifest) validateStringArray(manifest.keywords, `${where}.keywords`)
  if ('capability_set' in manifest) validateStringArray(manifest.capability_set, `${where}.capability_set`)
  if ('declared_network_domains' in manifest) validateStringArray(manifest.declared_network_domains, `${where}.declared_network_domains`)
  if ('declared_secrets' in manifest) validateStringArray(manifest.declared_secrets, `${where}.declared_secrets`)
  if ('runtime_requirements' in manifest) validateStringArray(manifest.runtime_requirements, `${where}.runtime_requirements`)

  assert(layout.manifestField in manifest, `Invalid ${where}.${layout.manifestField}: expected a canonical relative path`)
  const entryPath = manifest[layout.manifestField]
  assertString(entryPath, `${where}.${layout.manifestField}`)
  assertPattern(entryPath, RELATIVE_PATH_PATTERN, `${where}.${layout.manifestField}`)
  return entryPath
}

function canonicalizeSourceArtifact(artifact, artifactMeta, expectedSnapshotDigest, where) {
  assertPlainObject(artifact, where)
  assertAdditionalProperties(
    artifact,
    new Set(['$schema', 'upstream_repo', 'upstream_tag', 'upstream_commit', 'plugin_path', 'artifact_kind', 'artifact_path', 'submitted_by', 'snapshot_created_at', 'snapshot_tree_digest']),
    where,
  )
  if ('$schema' in artifact) {
    assert(artifact.$schema === SOURCE_SCHEMA_URL, `Invalid ${where}.$schema: expected "${SOURCE_SCHEMA_URL}"`)
  }
  assertUri(artifact.upstream_repo, `${where}.upstream_repo`)
  assertString(artifact.upstream_tag, `${where}.upstream_tag`)
  assertPattern(artifact.upstream_commit, FULL_COMMIT_SHA_PATTERN, `${where}.upstream_commit`)
  if (artifactMeta.kind === 'plugin') {
    assertString(artifact.plugin_path, `${where}.plugin_path`)
    assertPattern(artifact.plugin_path, RELATIVE_PATH_PATTERN, `${where}.plugin_path`)
    assert(!('artifact_path' in artifact), `Invalid ${where}.artifact_path: plugin source artifacts must use plugin_path`)
    assert(!('artifact_kind' in artifact), `Invalid ${where}.artifact_kind: plugin source artifacts must use plugin_path`)
  } else {
    assert(artifact.artifact_kind === artifactMeta.kind, `Invalid ${where}.artifact_kind: expected "${artifactMeta.kind}"`)
    assertString(artifact.artifact_path, `${where}.artifact_path`)
    assertPattern(artifact.artifact_path, RELATIVE_PATH_PATTERN, `${where}.artifact_path`)
    assert(!('plugin_path' in artifact), `Invalid ${where}.plugin_path: standalone artifact sources must use artifact_path`)
  }
  assertString(artifact.submitted_by, `${where}.submitted_by`)
  assertDateTime(artifact.snapshot_created_at, `${where}.snapshot_created_at`)
  if ('snapshot_tree_digest' in artifact) {
    assertPattern(artifact.snapshot_tree_digest, SHA256_PATTERN, `${where}.snapshot_tree_digest`)
  }
  const canonical = {
    $schema: SOURCE_SCHEMA_URL,
    upstream_repo: artifact.upstream_repo,
    upstream_tag: artifact.upstream_tag,
    upstream_commit: artifact.upstream_commit,
    submitted_by: artifact.submitted_by,
    snapshot_created_at: artifact.snapshot_created_at,
    snapshot_tree_digest: expectedSnapshotDigest,
  }
  if (artifactMeta.kind === 'plugin') {
    canonical.plugin_path = artifact.plugin_path
  } else {
    canonical.artifact_kind = artifactMeta.kind
    canonical.artifact_path = artifact.artifact_path
  }
  return sortKeys(canonical)
}

function canonicalizeLockArtifact(artifact, artifactMeta, version, expectedFileDigests, expectedSnapshotDigest, where) {
  assertPlainObject(artifact, where)
  assertAdditionalProperties(
    artifact,
    new Set(['$schema', 'plugin', 'artifact_kind', 'artifact_id', 'version', 'file_digests', 'capability_set', 'declared_network_domains', 'declared_secrets', 'runtime_requirements', 'dependencies', 'snapshot_digest']),
    where,
  )
  if ('$schema' in artifact) {
    assert(artifact.$schema === LOCK_SCHEMA_URL, `Invalid ${where}.$schema: expected "${LOCK_SCHEMA_URL}"`)
  }
  if (artifactMeta.kind === 'plugin') {
    assert(artifact.plugin === artifactMeta.artifactId, `Invalid ${where}.plugin: expected "${artifactMeta.artifactId}"`)
    assert(!('artifact_kind' in artifact), `Invalid ${where}.artifact_kind: plugin lock artifacts must use plugin`)
    assert(!('artifact_id' in artifact), `Invalid ${where}.artifact_id: plugin lock artifacts must use plugin`)
  } else {
    assert(artifact.artifact_kind === artifactMeta.kind, `Invalid ${where}.artifact_kind: expected "${artifactMeta.kind}"`)
    assert(artifact.artifact_id === artifactMeta.artifactId, `Invalid ${where}.artifact_id: expected "${artifactMeta.artifactId}"`)
    assert(!('plugin' in artifact), `Invalid ${where}.plugin: standalone artifact locks must use artifact_id`)
  }
  assert(artifact.version === version, `Invalid ${where}.version: expected "${version}"`)
  validateFileDigests(artifact.file_digests, `${where}.file_digests`)
  validateStringArray(artifact.capability_set, `${where}.capability_set`)
  validateStringArray(artifact.declared_network_domains, `${where}.declared_network_domains`)
  validateStringArray(artifact.declared_secrets, `${where}.declared_secrets`)
  validateStringArray(artifact.runtime_requirements, `${where}.runtime_requirements`)
  assertArray(artifact.dependencies, `${where}.dependencies`)
  for (let index = 0; index < artifact.dependencies.length; index += 1) {
    const dependency = artifact.dependencies[index]
    const dependencyWhere = `${where}.dependencies[${index}]`
    assertPlainObject(dependency, dependencyWhere)
    assertAdditionalProperties(dependency, new Set(['plugin', 'version']), dependencyWhere)
    assertPattern(dependency.plugin, PLUGIN_ID_PATTERN, `${dependencyWhere}.plugin`)
    assertPattern(dependency.version, SEMVER_PATTERN, `${dependencyWhere}.version`)
  }
  if ('snapshot_digest' in artifact) {
    assertPattern(artifact.snapshot_digest, SHA256_PATTERN, `${where}.snapshot_digest`)
  }
  const canonical = {
    $schema: LOCK_SCHEMA_URL,
    version,
    file_digests: expectedFileDigests,
    capability_set: artifact.capability_set,
    declared_network_domains: artifact.declared_network_domains,
    declared_secrets: artifact.declared_secrets,
    runtime_requirements: artifact.runtime_requirements,
    dependencies: artifact.dependencies,
    snapshot_digest: expectedSnapshotDigest,
  }
  if (artifactMeta.kind === 'plugin') {
    canonical.plugin = artifactMeta.artifactId
  } else {
    canonical.artifact_kind = artifactMeta.kind
    canonical.artifact_id = artifactMeta.artifactId
  }
  return sortKeys(canonical)
}

function validateReviewArtifact(artifact, where) {
  assertPlainObject(artifact, where)
  assertAdditionalProperties(
    artifact,
    new Set(['$schema', 'review_status', 'reviewer', 'reviewed_at', 'scanner_summary', 'policy_decisions', 'trust_tier_basis']),
    where,
  )
  if ('$schema' in artifact) {
    assert(artifact.$schema === REVIEW_SCHEMA_URL, `Invalid ${where}.$schema: expected "${REVIEW_SCHEMA_URL}"`)
  }
  assertSetMember(artifact.review_status, VALID_REVIEW_STATUS, `${where}.review_status`)
  assertString(artifact.reviewer, `${where}.reviewer`)
  assertDateTime(artifact.reviewed_at, `${where}.reviewed_at`)
  assertPlainObject(artifact.scanner_summary, `${where}.scanner_summary`)
  assertAdditionalProperties(artifact.scanner_summary, new Set(['status', 'findings']), `${where}.scanner_summary`)
  assertSetMember(artifact.scanner_summary.status, VALID_SCANNER_STATUS, `${where}.scanner_summary.status`)
  if ('findings' in artifact.scanner_summary) validateStringArray(artifact.scanner_summary.findings, `${where}.scanner_summary.findings`)
  validateStringArray(artifact.policy_decisions, `${where}.policy_decisions`)
  assertPlainObject(artifact.trust_tier_basis, `${where}.trust_tier_basis`)
  assertAdditionalProperties(artifact.trust_tier_basis, new Set(['trust_tier', 'installability', 'rationale']), `${where}.trust_tier_basis`)
  assertSetMember(artifact.trust_tier_basis.trust_tier, VALID_TRUST_TIERS, `${where}.trust_tier_basis.trust_tier`)
  assertSetMember(artifact.trust_tier_basis.installability, VALID_INSTALLABILITY_STATES, `${where}.trust_tier_basis.installability`)
  assert(
    artifact.trust_tier_basis.installability === mapInstallability(artifact.trust_tier_basis.trust_tier),
    `Invalid ${where}.trust_tier_basis.installability: expected "${mapInstallability(artifact.trust_tier_basis.trust_tier)}"`,
  )
  assertString(artifact.trust_tier_basis.rationale, `${where}.trust_tier_basis.rationale`)
}

function validateAdvisoriesDocument(advisories, pluginVersionLookup) {
  const where = 'advisories.json'
  assertPlainObject(advisories, where)
  assertAdditionalProperties(advisories, new Set(['$schema', 'generated_at', 'items']), where)
  if ('$schema' in advisories) {
    assert(advisories.$schema === ADVISORIES_SCHEMA_URL, `Invalid ${where}.$schema: expected "${ADVISORIES_SCHEMA_URL}"`)
  }
  assertDateTime(advisories.generated_at, `${where}.generated_at`)
  assertArray(advisories.items, `${where}.items`)

  const advisoryIds = new Set()
  let latestPublishedAt = null

  advisories.items.forEach((item, index) => {
    const itemWhere = `${where}.items[${index}]`
    assertPlainObject(item, itemWhere)
    assertAdditionalProperties(item, new Set(['id', 'title', 'published_at', 'plugin', 'affected_versions', 'severity', 'advisory_type', 'remediation', 'replacement', 'blocked', 'yanked']), itemWhere)
    assertString(item.id, `${itemWhere}.id`)
    assert(!advisoryIds.has(item.id), `Invalid ${where}: duplicate advisory id "${item.id}"`)
    advisoryIds.add(item.id)
    assertString(item.title, `${itemWhere}.title`)
    assertDateTime(item.published_at, `${itemWhere}.published_at`)
    latestPublishedAt = latestPublishedAt == null || item.published_at > latestPublishedAt ? item.published_at : latestPublishedAt
    assertPattern(item.plugin, PLUGIN_ID_PATTERN, `${itemWhere}.plugin`)
    assertArray(item.affected_versions, `${itemWhere}.affected_versions`)
    assert(item.affected_versions.length > 0, `Invalid ${itemWhere}.affected_versions: expected at least one affected version`)
    item.affected_versions.forEach((version, versionIndex) => {
      assertPattern(version, SEMVER_PATTERN, `${itemWhere}.affected_versions[${versionIndex}]`)
      const knownVersions = pluginVersionLookup.get(item.plugin)
      assert(knownVersions?.has(version), `Invalid ${itemWhere}.affected_versions[${versionIndex}]: unknown version "${version}"`)
    })
    assertSetMember(item.severity, VALID_ADVISORY_SEVERITIES, `${itemWhere}.severity`)
    assertSetMember(item.advisory_type, VALID_ADVISORY_TYPES, `${itemWhere}.advisory_type`)
    assertString(item.remediation, `${itemWhere}.remediation`)
    if ('replacement' in item) {
      assertPattern(item.replacement, PLUGIN_ID_PATTERN, `${itemWhere}.replacement`)
      assert(pluginVersionLookup.has(item.replacement), `Invalid ${itemWhere}.replacement: unknown plugin "${item.replacement}"`)
    }
    assertBoolean(item.blocked, `${itemWhere}.blocked`)
    assertBoolean(item.yanked, `${itemWhere}.yanked`)
    assert(!(item.blocked && item.yanked), `Invalid ${itemWhere}: blocked and yanked cannot both be true`)
  })

  const expectedGeneratedAt = latestPublishedAt ?? '1970-01-01T00:00:00Z'
  assert(advisories.generated_at === expectedGeneratedAt, `Invalid ${where}.generated_at: expected "${expectedGeneratedAt}"`)
  return advisories.items
}

function makeActiveVersionRecord(versionRecord) {
  return Object.fromEntries(VERSION_RECORD_FIELDS.map((field) => [field, versionRecord[field]]))
}

function generateHistoryDocument(artifactMeta) {
  const latestVersionRecord = artifactMeta.versions[0]
  const history = {
    $schema: PLUGIN_HISTORY_SCHEMA_URL,
    kind: artifactMeta.kind,
    artifact: artifactMeta.artifactId,
    namespace: artifactMeta.namespace,
    name: artifactMeta.name,
    description: artifactMeta.description,
    latest_version: latestVersionRecord.version,
    trust_tier: latestVersionRecord.trust_tier,
    installability: latestVersionRecord.installability,
    active_version: makeActiveVersionRecord(latestVersionRecord),
    keywords: maybeArray(artifactMeta.keywords),
    advisories: maybeArray(artifactMeta.advisoryIds),
    versions: artifactMeta.versions.map((versionRecord) => Object.fromEntries(VERSION_RECORD_FIELDS.map((field) => [field, versionRecord[field]]))),
  }
  if (artifactMeta.kind === 'plugin') {
    history.plugin = artifactMeta.artifactId
  }
  return sortKeys(history)
}

function validateHistoryDocument(history, artifactMeta, expectedHistoryPath) {
  const where = expectedHistoryPath
  const expected = generateHistoryDocument(artifactMeta)
  assertPlainObject(history, where)
  assertAdditionalProperties(history, new Set(['$schema', 'kind', 'artifact', 'plugin', 'namespace', 'name', 'description', 'latest_version', 'trust_tier', 'installability', 'active_version', 'keywords', 'advisories', 'versions']), where)
  if ('$schema' in history) {
    assert(history.$schema === PLUGIN_HISTORY_SCHEMA_URL, `Invalid ${where}.$schema: expected "${PLUGIN_HISTORY_SCHEMA_URL}"`)
  }
  assertArtifactKind(history.kind, `${where}.kind`)
  assert(history.kind === artifactMeta.kind, `Invalid ${where}.kind: expected "${artifactMeta.kind}"`)
  assertPattern(history.artifact, PLUGIN_ID_PATTERN, `${where}.artifact`)
  assert(history.artifact === artifactMeta.artifactId, `Invalid ${where}.artifact: expected "${artifactMeta.artifactId}"`)
  if (artifactMeta.kind === 'plugin') {
    assertPattern(history.plugin, PLUGIN_ID_PATTERN, `${where}.plugin`)
    assert(history.plugin === artifactMeta.artifactId, `Invalid ${where}.plugin: expected "${artifactMeta.artifactId}"`)
  } else {
    assert(!('plugin' in history), `Invalid ${where}.plugin: standalone artifact histories must not carry plugin aliases`)
  }
  assertPattern(history.namespace, NAMESPACE_PATTERN, `${where}.namespace`)
  assertString(history.name, `${where}.name`)
  assertString(history.description, `${where}.description`)
  assertPattern(history.latest_version, SEMVER_PATTERN, `${where}.latest_version`)
  assertSetMember(history.trust_tier, VALID_TRUST_TIERS, `${where}.trust_tier`)
  assertSetMember(history.installability, VALID_INSTALLABILITY_STATES, `${where}.installability`)
  assert(history.installability === mapInstallability(history.trust_tier), `Invalid ${where}.installability: expected "${mapInstallability(history.trust_tier)}"`)
  assertPlainObject(history.active_version, `${where}.active_version`)
  if ('keywords' in history) validateStringArray(history.keywords, `${where}.keywords`)
  if ('advisories' in history) validateStringArray(history.advisories, `${where}.advisories`)
  assertArray(history.versions, `${where}.versions`)
  assert(history.versions.length > 0, `Invalid ${where}.versions: expected at least one version`)
  assert(stableJson(history) === stableJson(expected), `Invalid ${where}: history document does not match the canonical plugin tree`)
  return expected
}

function generateRegistryDocument(registryItems, generatedAt) {
  const payload = sortKeys({
    $schema: REGISTRY_SCHEMA_URL,
    contract_version: '1',
    registry_alias: REGISTRY_ALIAS,
    source_repository: SOURCE_REPOSITORY,
    generated_at: generatedAt,
    items: registryItems,
  })
  return sortKeys({
    ...payload,
    signature: {
      algorithm: SIGNATURE_ALGORITHM,
      key_id: SIGNATURE_KEY_ID,
      target: SIGNATURE_TARGET,
      signed_digest: digestObject(payload),
    },
  })
}

function validateRegistryDocument(registry, expectedRegistry) {
  const where = 'registry.json'
  assertPlainObject(registry, where)
  assertAdditionalProperties(registry, new Set(['$schema', 'contract_version', 'registry_alias', 'source_repository', 'generated_at', 'signature', 'items']), where)
  if ('$schema' in registry) {
    assert(registry.$schema === REGISTRY_SCHEMA_URL, `Invalid ${where}.$schema: expected "${REGISTRY_SCHEMA_URL}"`)
  }
  assert(registry.contract_version === '1', `Invalid ${where}.contract_version: expected "1"`)
  assert(registry.registry_alias === REGISTRY_ALIAS, `Invalid ${where}.registry_alias: expected "${REGISTRY_ALIAS}"`)
  assertUri(registry.source_repository, `${where}.source_repository`)
  assertDateTime(registry.generated_at, `${where}.generated_at`)
  assertPlainObject(registry.signature, `${where}.signature`)
  assertAdditionalProperties(registry.signature, new Set(['algorithm', 'key_id', 'target', 'signed_digest']), `${where}.signature`)
  assert(registry.signature.algorithm === SIGNATURE_ALGORITHM, `Invalid ${where}.signature.algorithm: expected "${SIGNATURE_ALGORITHM}"`)
  assert(registry.signature.key_id === SIGNATURE_KEY_ID, `Invalid ${where}.signature.key_id: expected "${SIGNATURE_KEY_ID}"`)
  assert(registry.signature.target === SIGNATURE_TARGET, `Invalid ${where}.signature.target: expected "${SIGNATURE_TARGET}"`)
  assertPattern(registry.signature.signed_digest, SHA256_PATTERN, `${where}.signature.signed_digest`)
  assertArray(registry.items, `${where}.items`)
  for (let index = 0; index < registry.items.length; index += 1) {
    const item = registry.items[index]
    const itemWhere = `${where}.items[${index}]`
    assertPlainObject(item, itemWhere)
    assertArtifactKind(item.kind, `${itemWhere}.kind`)
    assertPattern(item.artifact, PLUGIN_ID_PATTERN, `${itemWhere}.artifact`)
    assertProductionArtifactAllowed(item.artifact, `${itemWhere}.artifact`)
    if (item.kind === 'plugin') {
      assert(item.plugin === item.artifact, `Invalid ${itemWhere}.plugin: expected plugin alias to match artifact`)
    } else {
      assert(!('plugin' in item), `Invalid ${itemWhere}.plugin: standalone artifact rows must not carry plugin aliases`)
    }
  }
  assert(stableJson(registry) === stableJson(expectedRegistry), `Invalid ${where}: committed registry index drifts from the canonical tree`)
}

async function upsertJson(filePath, expectedValue, mode) {
  const existingValue = await readJsonIfExists(filePath)
  if (mode === 'write') {
    await writeJson(filePath, expectedValue)
    return JSON.parse(stableJson(expectedValue))
  }
  assert(existingValue !== undefined, `Missing required file: ${path.relative(process.cwd(), filePath)}`)
  assert(stableJson(existingValue) === stableJson(expectedValue), `Invalid ${path.relative(process.cwd(), filePath)}: expected canonical generated content`)
  return existingValue
}

async function collectPluginMetadata(pluginRoot, advisoriesByPlugin, mode, enforceAdvisoryConsistency = true) {
  const namespaceEntries = (await listEntries(pluginRoot)).filter((entry) => entry.name !== SKELETON_KEEP_FILE)
  const nonDirectoryEntries = namespaceEntries.filter((entry) => !entry.isDirectory())
  assert(nonDirectoryEntries.length === 0, `plugins/ must contain only namespace directories, found: ${nonDirectoryEntries.map((entry) => entry.name).join(', ')}`)

  const pluginMetas = []
  const pluginVersionLookup = new Map()

  for (const namespaceEntry of namespaceEntries) {
    const namespace = namespaceEntry.name
    assertPattern(namespace, NAMESPACE_PATTERN, `plugins/${namespace}`)
    const namespaceDir = path.join(pluginRoot, namespace)
    await ensureDirectory(namespaceDir, `plugins/${namespace}`)

    const pluginEntries = await listEntries(namespaceDir)
    const invalidNamespaceChildren = pluginEntries.filter((entry) => !entry.isDirectory())
    assert(invalidNamespaceChildren.length === 0, `plugins/${namespace} must contain only plugin directories, found: ${invalidNamespaceChildren.map((entry) => entry.name).join(', ')}`)

    for (const pluginEntry of pluginEntries) {
      const pluginName = pluginEntry.name
      assertPattern(pluginName, PLUGIN_NAME_PATTERN, `plugins/${namespace}/${pluginName}`)
      const pluginDir = path.join(namespaceDir, pluginName)
      await ensureDirectory(pluginDir, `plugins/${namespace}/${pluginName}`)

      const pluginDirEntries = await listEntries(pluginDir)
      const pluginDirNames = pluginDirEntries.map((entry) => entry.name)
      const allowedPluginDirEntries = mode === 'write' ? new Set(['plugin.json', 'versions']) : new Set(['plugin.json', 'versions'])
      const unexpectedPluginDirEntries = pluginDirNames.filter((entryName) => !allowedPluginDirEntries.has(entryName))
      assert(unexpectedPluginDirEntries.length === 0, `plugins/${namespace}/${pluginName} must contain only plugin.json and versions/`)
      assert(pluginDirNames.includes('versions'), `Missing required directory: plugins/${namespace}/${pluginName}/versions`)
      if (mode === 'check') {
        assert(pluginDirNames.includes('plugin.json'), `Missing required file: plugins/${namespace}/${pluginName}/plugin.json`)
      }

      const versionsDir = path.join(pluginDir, 'versions')
      await ensureDirectory(versionsDir, `plugins/${namespace}/${pluginName}/versions`)
      const versionEntries = await listEntries(versionsDir)
      const invalidVersionEntries = versionEntries.filter((entry) => !entry.isDirectory() || !SEMVER_PATTERN.test(entry.name))
      assert(
        invalidVersionEntries.length === 0,
        `plugins/${namespace}/${pluginName}/versions must contain only semver directories, found: ${invalidVersionEntries.map((entry) => entry.name).join(', ')}`,
      )
      assert(versionEntries.length > 0, `plugins/${namespace}/${pluginName}/versions must contain at least one version`)

      const pluginId = `${namespace}.${pluginName}`
      assertProductionArtifactAllowed(pluginId, `plugins/${namespace}/${pluginName}`)
      const pluginIdentity = { kind: 'plugin', artifactId: pluginId }
      const versionRecords = []
      pluginVersionLookup.set(pluginId, new Set(versionEntries.map((entry) => entry.name)))

      for (const versionEntry of versionEntries.sort((left, right) => compareSemver(right.name, left.name))) {
        const version = versionEntry.name
        const versionDir = path.join(versionsDir, version)
        const relativeVersionRoot = path.posix.join('plugins', namespace, pluginName, 'versions', version)

        const versionDirEntries = await listEntries(versionDir)
        const versionNames = new Set(versionDirEntries.map((entry) => entry.name))
        for (const requiredFile of REQUIRED_VERSION_FILES) {
          assert(versionNames.has(requiredFile), `Missing required file: ${relativeVersionRoot}/${requiredFile}`)
        }
        assert(versionNames.has('.plugin'), `Missing required directory: ${relativeVersionRoot}/.plugin`)

        await ensureDirectory(path.join(versionDir, '.plugin'), `${relativeVersionRoot}/.plugin`)
        await ensureRegularFile(path.join(versionDir, '.plugin', 'plugin.json'), `${relativeVersionRoot}/.plugin/plugin.json`)
        await ensureRegularFile(path.join(versionDir, 'README.md'), `${relativeVersionRoot}/README.md`)
        await ensureRegularFile(path.join(versionDir, 'LICENSE'), `${relativeVersionRoot}/LICENSE`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_SOURCE.json'), `${relativeVersionRoot}/AGENTRIG_SOURCE.json`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_LOCK.json'), `${relativeVersionRoot}/AGENTRIG_LOCK.json`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_REVIEW.json'), `${relativeVersionRoot}/AGENTRIG_REVIEW.json`)

        const pluginManifest = await readJson(path.join(versionDir, '.plugin', 'plugin.json'))
        validatePluginManifest(pluginManifest, pluginId, version, `${relativeVersionRoot}/.plugin/plugin.json`)

        const { fileDigests, snapshotDigest } = await computeVersionDigests(versionDir)

        const sourcePath = path.join(versionDir, 'AGENTRIG_SOURCE.json')
        const sourceArtifact = await readJson(sourcePath)
        const expectedSourceArtifact = canonicalizeSourceArtifact(sourceArtifact, pluginIdentity, snapshotDigest, `${relativeVersionRoot}/AGENTRIG_SOURCE.json`)
        await upsertJson(sourcePath, expectedSourceArtifact, mode)

        const lockPath = path.join(versionDir, 'AGENTRIG_LOCK.json')
        const lockArtifact = await readJson(lockPath)
        const expectedLockArtifact = canonicalizeLockArtifact(lockArtifact, pluginIdentity, version, fileDigests, snapshotDigest, `${relativeVersionRoot}/AGENTRIG_LOCK.json`)
        await upsertJson(lockPath, expectedLockArtifact, mode)

        const reviewArtifact = await readJson(path.join(versionDir, 'AGENTRIG_REVIEW.json'))
        validateReviewArtifact(reviewArtifact, `${relativeVersionRoot}/AGENTRIG_REVIEW.json`)

        const trustTier = reviewArtifact.trust_tier_basis.trust_tier
        const installability = reviewArtifact.trust_tier_basis.installability
        const advisoryIds = advisoriesByPlugin.get(pluginId)?.map((advisory) => advisory.id) ?? []

        versionRecords.push(sortKeys({
          version,
          path: `${relativeVersionRoot}/`,
          manifest: `${relativeVersionRoot}/.plugin/plugin.json`,
          source: `${relativeVersionRoot}/AGENTRIG_SOURCE.json`,
          lock: `${relativeVersionRoot}/AGENTRIG_LOCK.json`,
          review: `${relativeVersionRoot}/AGENTRIG_REVIEW.json`,
          trust_tier: trustTier,
          installability,
          snapshot_digest: snapshotDigest,
          published_at: reviewArtifact.reviewed_at,
        }))

        if (enforceAdvisoryConsistency && trustTier === 'blocked') {
          assert(
            (advisoriesByPlugin.get(pluginId) ?? []).some((advisory) => advisory.blocked),
            `plugins/${namespace}/${pluginName}: blocked plugins must have at least one blocked advisory`,
          )
        }
        if (enforceAdvisoryConsistency && trustTier === 'yanked') {
          assert(
            (advisoriesByPlugin.get(pluginId) ?? []).some((advisory) => advisory.yanked),
            `plugins/${namespace}/${pluginName}: yanked plugins must have at least one yanked advisory`,
          )
        }
      }

      const latestManifest = await readJson(path.join(versionsDir, versionRecords[0].version, '.plugin', 'plugin.json'))
      const pluginMeta = {
        kind: 'plugin',
        root: 'plugins',
        historyFile: 'plugin.json',
        artifactId: pluginId,
        namespace,
        artifactName: pluginName,
        name: latestManifest.name,
        description: latestManifest.description,
        keywords: latestManifest.keywords ?? [],
        advisoryIds: advisoriesByPlugin.get(pluginId)?.map((advisory) => advisory.id) ?? [],
        versions: versionRecords,
      }
      pluginMetas.push(pluginMeta)
    }
  }

  pluginMetas.sort((left, right) => left.artifactId.localeCompare(right.artifactId))
  return { pluginMetas, pluginVersionLookup }
}

async function collectStandaloneArtifactMetadata(repoRoot, layout, mode) {
  const artifactRoot = path.join(repoRoot, layout.root)
  if (!(await pathExists(artifactRoot))) {
    return []
  }

  await ensureDirectory(artifactRoot, `${layout.root}/`)
  const namespaceEntries = (await listEntries(artifactRoot)).filter((entry) => entry.name !== SKELETON_KEEP_FILE)
  const nonDirectoryEntries = namespaceEntries.filter((entry) => !entry.isDirectory())
  assert(nonDirectoryEntries.length === 0, `${layout.root}/ must contain only namespace directories, found: ${nonDirectoryEntries.map((entry) => entry.name).join(', ')}`)

  const artifactMetas = []

  for (const namespaceEntry of namespaceEntries) {
    const namespace = namespaceEntry.name
    assertPattern(namespace, NAMESPACE_PATTERN, `${layout.root}/${namespace}`)
    const namespaceDir = path.join(artifactRoot, namespace)
    await ensureDirectory(namespaceDir, `${layout.root}/${namespace}`)

    const artifactEntries = await listEntries(namespaceDir)
    const invalidNamespaceChildren = artifactEntries.filter((entry) => !entry.isDirectory())
    assert(
      invalidNamespaceChildren.length === 0,
      `${layout.root}/${namespace} must contain only artifact directories, found: ${invalidNamespaceChildren.map((entry) => entry.name).join(', ')}`,
    )

    for (const artifactEntry of artifactEntries) {
      const artifactName = artifactEntry.name
      assertPattern(artifactName, PLUGIN_NAME_PATTERN, `${layout.root}/${namespace}/${artifactName}`)
      const artifactId = `${namespace}.${artifactName}`
      assertProductionArtifactAllowed(artifactId, `${layout.root}/${namespace}/${artifactName}`)
      const artifactIdentity = { kind: layout.kind, artifactId }
      const artifactDir = path.join(namespaceDir, artifactName)
      await ensureDirectory(artifactDir, `${layout.root}/${namespace}/${artifactName}`)

      const artifactDirEntries = await listEntries(artifactDir)
      const artifactDirNames = artifactDirEntries.map((entry) => entry.name)
      const unexpectedArtifactDirEntries = artifactDirNames.filter((entryName) => !new Set([layout.historyFile, 'versions']).has(entryName))
      assert(unexpectedArtifactDirEntries.length === 0, `${layout.root}/${namespace}/${artifactName} must contain only ${layout.historyFile} and versions/`)
      assert(artifactDirNames.includes('versions'), `Missing required directory: ${layout.root}/${namespace}/${artifactName}/versions`)
      if (mode === 'check') {
        assert(artifactDirNames.includes(layout.historyFile), `Missing required file: ${layout.root}/${namespace}/${artifactName}/${layout.historyFile}`)
      }

      const versionsDir = path.join(artifactDir, 'versions')
      await ensureDirectory(versionsDir, `${layout.root}/${namespace}/${artifactName}/versions`)
      const versionEntries = await listEntries(versionsDir)
      const invalidVersionEntries = versionEntries.filter((entry) => !entry.isDirectory() || !SEMVER_PATTERN.test(entry.name))
      assert(
        invalidVersionEntries.length === 0,
        `${layout.root}/${namespace}/${artifactName}/versions must contain only semver directories, found: ${invalidVersionEntries.map((entry) => entry.name).join(', ')}`,
      )
      assert(versionEntries.length > 0, `${layout.root}/${namespace}/${artifactName}/versions must contain at least one version`)

      const versionRecords = []

      for (const versionEntry of versionEntries.sort((left, right) => compareSemver(right.name, left.name))) {
        const version = versionEntry.name
        const versionDir = path.join(versionsDir, version)
        const relativeVersionRoot = path.posix.join(layout.root, namespace, artifactName, 'versions', version)
        const relativeManifestPath = path.posix.join(relativeVersionRoot, layout.manifestDir, layout.manifestFile)

        const versionDirEntries = await listEntries(versionDir)
        const versionNames = new Set(versionDirEntries.map((entry) => entry.name))
        for (const requiredFile of REQUIRED_VERSION_FILES) {
          assert(versionNames.has(requiredFile), `Missing required file: ${relativeVersionRoot}/${requiredFile}`)
        }
        assert(versionNames.has(layout.manifestDir), `Missing required directory: ${relativeVersionRoot}/${layout.manifestDir}`)

        await ensureDirectory(path.join(versionDir, layout.manifestDir), `${relativeVersionRoot}/${layout.manifestDir}`)
        await ensureRegularFile(path.join(versionDir, layout.manifestDir, layout.manifestFile), `${relativeManifestPath}`)
        await ensureRegularFile(path.join(versionDir, 'README.md'), `${relativeVersionRoot}/README.md`)
        await ensureRegularFile(path.join(versionDir, 'LICENSE'), `${relativeVersionRoot}/LICENSE`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_SOURCE.json'), `${relativeVersionRoot}/AGENTRIG_SOURCE.json`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_LOCK.json'), `${relativeVersionRoot}/AGENTRIG_LOCK.json`)
        await ensureRegularFile(path.join(versionDir, 'AGENTRIG_REVIEW.json'), `${relativeVersionRoot}/AGENTRIG_REVIEW.json`)

        const manifest = await readJson(path.join(versionDir, layout.manifestDir, layout.manifestFile))
        const manifestEntryPath = validateStandaloneManifest(manifest, layout, artifactId, version, relativeManifestPath)
        await ensureRegularFile(
          path.join(versionDir, manifestEntryPath),
          `${relativeVersionRoot}/${manifestEntryPath}`,
        )

        const { fileDigests, snapshotDigest } = await computeVersionDigests(versionDir)

        const sourcePath = path.join(versionDir, 'AGENTRIG_SOURCE.json')
        const sourceArtifact = await readJson(sourcePath)
        const expectedSourceArtifact = canonicalizeSourceArtifact(sourceArtifact, artifactIdentity, snapshotDigest, `${relativeVersionRoot}/AGENTRIG_SOURCE.json`)
        await upsertJson(sourcePath, expectedSourceArtifact, mode)

        const lockPath = path.join(versionDir, 'AGENTRIG_LOCK.json')
        const lockArtifact = await readJson(lockPath)
        const expectedLockArtifact = canonicalizeLockArtifact(lockArtifact, artifactIdentity, version, fileDigests, snapshotDigest, `${relativeVersionRoot}/AGENTRIG_LOCK.json`)
        await upsertJson(lockPath, expectedLockArtifact, mode)

        const reviewArtifact = await readJson(path.join(versionDir, 'AGENTRIG_REVIEW.json'))
        validateReviewArtifact(reviewArtifact, `${relativeVersionRoot}/AGENTRIG_REVIEW.json`)

        versionRecords.push(sortKeys({
          version,
          path: `${relativeVersionRoot}/`,
          manifest: relativeManifestPath,
          source: `${relativeVersionRoot}/AGENTRIG_SOURCE.json`,
          lock: `${relativeVersionRoot}/AGENTRIG_LOCK.json`,
          review: `${relativeVersionRoot}/AGENTRIG_REVIEW.json`,
          trust_tier: reviewArtifact.trust_tier_basis.trust_tier,
          installability: reviewArtifact.trust_tier_basis.installability,
          snapshot_digest: snapshotDigest,
          published_at: reviewArtifact.reviewed_at,
        }))
      }

      const latestManifest = await readJson(path.join(versionsDir, versionRecords[0].version, layout.manifestDir, layout.manifestFile))
      artifactMetas.push({
        kind: layout.kind,
        root: layout.root,
        historyFile: layout.historyFile,
        artifactId,
        namespace,
        artifactName,
        name: latestManifest.name,
        description: latestManifest.description,
        keywords: latestManifest.keywords ?? [],
        advisoryIds: [],
        versions: versionRecords,
      })
    }
  }

  artifactMetas.sort((left, right) => left.artifactId.localeCompare(right.artifactId))
  return artifactMetas
}

async function syncRegistry(mode) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  const pluginRoot = path.join(repoRoot, 'plugins')
  const advisoriesPath = path.join(repoRoot, 'advisories.json')
  const registryPath = path.join(repoRoot, 'registry.json')

  await ensureDirectory(pluginRoot, 'plugins/')
  await ensureRegularFile(advisoriesPath, 'advisories.json')

  const rootEntries = await listEntries(repoRoot)
  const unexpectedRoots = rootEntries
    .filter((entry) => entry.name !== '.git' && !ROOT_ALLOWED_ENTRIES.has(entry.name))
    .map((entry) => entry.name)
  assert(unexpectedRoots.length === 0, `Unexpected root entries: ${unexpectedRoots.join(', ')}`)

  const advisories = await readJson(advisoriesPath)

  const emptyPluginVersionLookup = new Map()
  const bootstrapPluginMetas = await collectPluginMetadata(pluginRoot, new Map(), mode, false)
  const advisoryItems = validateAdvisoriesDocument(advisories, bootstrapPluginMetas.pluginVersionLookup ?? emptyPluginVersionLookup)
  const advisoriesByPlugin = new Map()
  for (const advisory of advisoryItems) {
    const current = advisoriesByPlugin.get(advisory.plugin) ?? []
    current.push(advisory)
    advisoriesByPlugin.set(advisory.plugin, current)
  }

  const { pluginMetas } = await collectPluginMetadata(pluginRoot, advisoriesByPlugin, mode)
  const standaloneMetas = []
  for (const layout of STANDALONE_ARTIFACT_LAYOUTS) {
    standaloneMetas.push(...(await collectStandaloneArtifactMetadata(repoRoot, layout, mode)))
  }
  const artifactMetas = [...pluginMetas, ...standaloneMetas].sort((left, right) => {
    const kindComparison = left.kind.localeCompare(right.kind)
    return kindComparison || left.artifactId.localeCompare(right.artifactId)
  })

  const normalizedAdvisories = sortKeys({
    $schema: ADVISORIES_SCHEMA_URL,
    generated_at: advisoryItems.reduce((latest, item) => latest == null || item.published_at > latest ? item.published_at : latest, null) ?? '1970-01-01T00:00:00Z',
    items: advisoryItems.slice().sort((left, right) => left.id.localeCompare(right.id)),
  })
  await upsertJson(advisoriesPath, normalizedAdvisories, mode)

  const generatedTimes = [normalizedAdvisories.generated_at]
  const registryItems = []

  for (const artifactMeta of artifactMetas) {
    for (const versionRecord of artifactMeta.versions) {
      generatedTimes.push(versionRecord.published_at)
    }

    const historyPath = path.join(repoRoot, artifactMeta.root, artifactMeta.namespace, artifactMeta.artifactName, artifactMeta.historyFile)
    const historyRelativePath = path.posix.join(artifactMeta.root, artifactMeta.namespace, artifactMeta.artifactName, artifactMeta.historyFile)
    const expectedHistory = generateHistoryDocument(artifactMeta)
    const existingHistory = await upsertJson(historyPath, expectedHistory, mode)
    validateHistoryDocument(existingHistory, artifactMeta, historyRelativePath)

    const registryItem = {
      kind: artifactMeta.kind,
      artifact: artifactMeta.artifactId,
      name: artifactMeta.name,
      description: artifactMeta.description,
      latest_version: artifactMeta.versions[0].version,
      history: historyRelativePath,
      active_version: makeActiveVersionRecord(artifactMeta.versions[0]),
      trust_tier: artifactMeta.versions[0].trust_tier,
      installability: artifactMeta.versions[0].installability,
      keywords: maybeArray(artifactMeta.keywords),
      advisories: maybeArray(artifactMeta.advisoryIds),
    }
    if (artifactMeta.kind === 'plugin') {
      registryItem.plugin = artifactMeta.artifactId
    }
    registryItems.push(sortKeys(registryItem))
  }

  registryItems.sort((left, right) => {
    const kindComparison = left.kind.localeCompare(right.kind)
    return kindComparison || left.artifact.localeCompare(right.artifact)
  })
  const generatedAt = generatedTimes.filter(Boolean).sort().at(-1) ?? '1970-01-01T00:00:00Z'
  const expectedRegistry = generateRegistryDocument(registryItems, generatedAt)
  const existingRegistry = await upsertJson(registryPath, expectedRegistry, mode)
  validateRegistryDocument(existingRegistry, expectedRegistry)

  console.log(`${mode === 'write' ? 'Synced' : 'Validated'} ${artifactMetas.length} registry artifact(s)`)
}

const mode = process.argv.includes('--write') ? 'write' : 'check'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncRegistry(mode).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

export { assertProductionArtifactAllowed, isProductionTestArtifactId }
