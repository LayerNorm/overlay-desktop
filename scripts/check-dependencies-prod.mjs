// Production dependency audit gate.
//
// Wraps `npm audit --omit=dev --audit-level=high --json` so we can carry an
// explicit allowlist of advisories that have no published fix and cannot ship
// an exploit path through this app. Any new high/critical finding that is not
// fully covered by the allowlist fails the gate.
//
// npm audit itself has no exclusion mechanism; keep this list short and link
// every entry to its advisory plus the reason it is acceptable to ship.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Findings keyed by package name are waived when every advisory reported
// against them (and every transitive package they pull in) is allowlisted.
// Direct advisories on the package itself are matched by GHSA id.
const ALLOWED_ADVISORY_URLS = new Set([
  // https://github.com/advisories/GHSA-vfj7-8cjw-p6xm — braces stack-exhaustion
  // DoS. All published versions (<= 3.0.3) are affected; there is no fixed
  // release to upgrade to. Reachable only through glob patterns the app itself
  // supplies (unstorage/chokidar, micromatch), not attacker input.
  'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'
])

function advisoriesOf(finding) {
  return (finding.via ?? []).filter((via) => typeof via === 'object' && via !== null)
}

function dependencyNamesOf(finding) {
  return (finding.via ?? []).filter((via) => typeof via === 'string')
}

let report
try {
  report = JSON.parse(
    execFileSync('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )
} catch (error) {
  // npm audit exits non-zero when findings exist; the JSON report is on stdout.
  const stdout = error.stdout?.toString() ?? ''
  if (!stdout.trimStart().startsWith('{')) {
    process.stderr.write(error.stderr?.toString() ?? String(error))
    process.exit(2)
  }
  report = JSON.parse(stdout)
}

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }
const failures = []
const waived = []

for (const [name, finding] of Object.entries(report.vulnerabilities ?? {})) {
  if ((severityRank[finding.severity] ?? 0) < severityRank.high) continue
  const direct = advisoriesOf(finding)
  const deps = dependencyNamesOf(finding)
  const uncoveredDirect = direct.filter((via) => !ALLOWED_ADVISORY_URLS.has(via.url))
  const uncoveredDeps = deps.filter((dep) => !waivableDependency(dep, report))
  if (uncoveredDirect.length === 0 && uncoveredDeps.length === 0) {
    waived.push(name)
  } else {
    failures.push({ name, finding, uncoveredDirect, uncoveredDeps })
  }
}

if (waived.length) {
  console.log(`Waived high findings fully covered by the allowlist: ${waived.join(', ')}`)
}
if (failures.length) {
  const lines = failures.flatMap(({ name, finding, uncoveredDirect, uncoveredDeps }) => [
    `- ${name} (${finding.severity}, ${finding.range})`,
    ...uncoveredDirect.map((via) => `    advisory: ${via.url ?? via.title}`),
    ...uncoveredDeps.map((dep) => `    depends on vulnerable ${dep}`)
  ])
  console.error(`Production dependency audit failed:\n${lines.join('\n')}`)
  process.exit(1)
}
console.log('Production dependency audit passed (high/critical findings resolved or allowlisted).')

function waivableDependency(name, report, seen = new Set()) {
  if (seen.has(name)) return false
  seen.add(name)
  const finding = report.vulnerabilities?.[name]
  if (!finding) return false
  const direct = advisoriesOf(finding)
  if (direct.some((via) => !ALLOWED_ADVISORY_URLS.has(via.url))) return false
  return dependencyNamesOf(finding).every((dep) => waivableDependency(dep, report, seen))
}
