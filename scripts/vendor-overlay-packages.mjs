#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Vendor @overlay/* and @layernorm/* workspace packages from an overlay-web
 * checkout into packages/.
 *
 * Usage:
 *   node scripts/vendor-overlay-packages.mjs --upstream /path/to/overlay-web
 *   node scripts/vendor-overlay-packages.mjs --upstream /path/to/overlay-web --check
 *
 * --upstream defaults to ../packages when this repository sits inside an
 * overlay-web checkout as a submodule (overlay-web/overlay-desktop), then to
 * $OVERLAY_WEB_DIR/packages.
 *
 * --check performs a dry run into a temp directory and reports whether
 * packages/ matches what the sync would produce (CI drift gate).
 *
 * The transform mirrors what the original manual vendoring did:
 *   - copy each packages/overlay-* directory verbatim (minus build output)
 *   - rewrite each internal package.json for the public repo: private:false,
 *     license Apache-2.0, files/publishConfig, file: deps -> "0.0.1"
 *   - inline overlay-api-client's out-of-package imports (src/shared/schemas,
 *     src/shared/api/pagination) into the vendored tree
 *   - drop the out-of-package tsconfig include
 *   - record the upstream SHA in packages/UPSTREAM.json
 *   - add LICENSE/README.md for packages that lack them
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { upstream: null, check: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') args.check = true
    else if (a === '--upstream') args.upstream = argv[++i]
    else if (a.startsWith('--upstream=')) args.upstream = a.slice('--upstream='.length)
    else fail(`unknown argument: ${a}`)
  }
  return args
}

function fail(message) {
  console.error(`vendor-overlay-packages: ${message}`)
  process.exit(1)
}

function resolveUpstreamDir(arg) {
  const candidates = []
  if (arg) candidates.push(arg)
  candidates.push(path.join(repoRoot, '..', 'packages'))
  if (process.env.OVERLAY_WEB_DIR) {
    candidates.push(path.join(process.env.OVERLAY_WEB_DIR, 'packages'))
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    const dir = resolved.endsWith(`${path.sep}packages`) || path.basename(resolved) === 'packages'
      ? resolved
      : path.join(resolved, 'packages')
    if (fs.existsSync(path.join(dir, 'overlay-app-core', 'package.json'))) {
      return dir
    }
  }
  fail(
    'could not locate an overlay-web packages/ directory. Pass --upstream /path/to/overlay-web ' +
      'or set OVERLAY_WEB_DIR.'
  )
}

const SKIP_ENTRIES = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.next', 'out'])

function copyPackageTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) copyPackageTree(src, dest)
    else if (entry.isFile() || entry.isSymbolicLink()) fs.copyFileSync(src, dest)
  }
}

function rewriteFileDeps(pkg) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field]
    if (!deps) continue
    for (const name of Object.keys(deps)) {
      if (typeof deps[name] === 'string' && deps[name].startsWith('file:')) {
        deps[name] = '0.0.1'
      }
    }
  }
}

function loadApacheLicense() {
  // Read before any sync wipes packages/ — every vendored package carries the
  // same Apache-2.0 LICENSE file.
  const packagesDir = path.join(repoRoot, 'packages')
  const candidates = [
    path.join(packagesDir, 'overlay-api-client', 'LICENSE'),
    ...fs
      .readdirSync(packagesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(packagesDir, e.name, 'LICENSE'))
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8')
  }
  fail('no packages/*/LICENSE found to seed vendored package licenses')
}

const APACHE_LICENSE = loadApacheLicense()

function transformPackageJson(pkgDir, pkgName, isLayernorm) {
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  rewriteFileDeps(pkg)
  if (isLayernorm) {
    // Public packages ship dist builds upstream; in this repo they are consumed
    // as TypeScript source like every other vendored package.
    const srcIndex = './src/index.ts'
    pkg.main = srcIndex
    pkg.types = srcIndex
    if (pkg.exports && pkg.exports['.']) {
      pkg.exports['.'] = srcIndex
    }
    if (Array.isArray(pkg.files) && !pkg.files.includes('src')) {
      pkg.files = ['src', ...pkg.files]
    }
    if (pkg.scripts) {
      delete pkg.scripts.prepack
      if (typeof pkg.scripts.test === 'string') {
        pkg.scripts.test = pkg.scripts.test.replace(/^npm run build && /, '')
      }
      delete pkg.scripts.build
    }
    // The standalone-repo gate requires every vendored package to carry the
    // same public publish shape.
    pkg.private = false
    pkg.license = 'Apache-2.0'
    pkg.publishConfig = { access: 'public', provenance: true }
    if (Array.isArray(pkg.files) && !pkg.files.includes('LICENSE')) {
      pkg.files = [...pkg.files, 'LICENSE', 'README.md']
    }
  } else {
    pkg.private = false
    pkg.license = 'Apache-2.0'
    pkg.files = ['src', 'README.md', 'LICENSE', 'tsconfig.json']
    pkg.publishConfig = { access: 'public', provenance: true }
    if (pkg.name?.startsWith('@overlay/') && pkg.version !== '0.0.1') {
      pkg.version = '0.0.1'
    }
  }
  fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)

  if (!fs.existsSync(path.join(pkgDir, 'LICENSE'))) {
    fs.writeFileSync(path.join(pkgDir, 'LICENSE'), APACHE_LICENSE)
  }
  if (!fs.existsSync(path.join(pkgDir, 'README.md'))) {
    fs.writeFileSync(
      path.join(pkgDir, 'README.md'),
      `# ${pkg.name}\n\nVendored from [LayerNorm/overlay-web](https://github.com/LayerNorm/overlay-web) \`packages/${pkgName}\`.\n`
    )
  }
}

// Out-of-package imports that must be inlined into the vendored tree.
// Maps the upstream app-tree source (relative to upstream root) to a directory
// copied inside the vendored package.
const SHARED_COPIES = [
  {
    upstream: 'src/shared/schemas',
    into: 'src/schemas',
    package: 'overlay-api-client',
    excludeTests: true
  },
  {
    upstream: 'src/shared/api/pagination.ts',
    into: 'src/shared/pagination.ts',
    package: 'overlay-api-client',
    excludeTests: false
  }
]

function copyDirFiltered(src, dest, excludeTests) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirFiltered(srcPath, destPath, excludeTests)
    else if (entry.isFile()) {
      if (excludeTests && /\.test\.tsx?$/.test(entry.name)) continue
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function inlineSharedCopies(upstreamRoot, packagesDir) {
  for (const spec of SHARED_COPIES) {
    const src = path.join(upstreamRoot, spec.upstream)
    const dest = path.join(packagesDir, spec.package, spec.into)
    if (!fs.existsSync(src)) fail(`expected upstream source ${spec.upstream} is missing`)
    if (fs.statSync(src).isDirectory()) {
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true })
      copyDirFiltered(src, dest, spec.excludeTests)
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
    }
  }
}

// Rewrite `('../)*src/shared/<rest>` import specifiers in vendored files to the
// inlined copies inside the same package.
function rewriteOutOfPackageImports(pkgDir) {
  const files = []
  ;(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name)) files.push(p)
    }
  })(pkgDir)

  const importRe = /(['"])((?:\.\.\/)+)src\/shared\/([^'"]+)\1/g
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8')
    let changed = false
    text = text.replace(importRe, (match, quote, upDots, rest) => {
      // Map the upstream app-tree path to the vendored location.
      const sharedPath = `src/shared/${rest}`
      let target = null
      if (sharedPath === 'src/shared/schemas' || sharedPath.startsWith('src/shared/schemas/')) {
        const sub = sharedPath.slice('src/shared/schemas'.length)
        target = `src/schemas${sub}`
      } else if (sharedPath === 'src/shared/api/pagination') {
        target = 'src/shared/pagination'
      }
      if (!target) {
        fail(`${path.relative(repoRoot, file)} imports out-of-package '${sharedPath}' with no vendored mapping`)
      }
      const fromDir = path.relative(pkgDir, path.dirname(file))
      let rel = path.posix.relative(fromDir.split(path.sep).join('/'), target)
      if (!rel.startsWith('.')) rel = `./${rel}`
      changed = true
      return `${quote}${rel}${quote}`
    })
    if (changed) fs.writeFileSync(file, text)
  }
}

// The desktop app compiles vendored sources against zod 4 while overlay-web
// still pins zod 3. Rewrite the single-argument `z.record(value)` form (valid
// in v3, invalid in v4) to `z.record(z.string(), value)`. Two-argument calls
// already contain a comma and are never matched.
function rewriteZodCompat(pkgDir) {
  const files = []
  ;(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name)) files.push(p)
    }
  })(pkgDir)

  const recordRe = /z\.record\((z\.[a-zA-Z]+(?:\([^()]*\))?)\)/g
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const rewritten = text.replace(recordRe, (match, value) => `z.record(z.string(), ${value})`)
    if (rewritten !== text) fs.writeFileSync(file, rewritten)
  }
}

function fixTsconfigInclude(pkgDir) {
  const tsconfigPath = path.join(pkgDir, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) return
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'))
  if (!Array.isArray(tsconfig.include)) return
  const filtered = tsconfig.include.filter((p) => !p.includes('../../'))
  if (filtered.length !== tsconfig.include.length) {
    tsconfig.include = filtered
    fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
  }
}

function upstreamSha(upstreamRoot) {
  try {
    return execSync('git rev-parse HEAD', { cwd: upstreamRoot, encoding: 'utf8' }).trim()
  } catch {
    fail(`${upstreamRoot} is not a git checkout; cannot record upstream SHA`)
  }
}

function listUpstreamPackages(upstreamPackagesDir) {
  return fs
    .readdirSync(upstreamPackagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('overlay-'))
    .filter((e) => fs.existsSync(path.join(upstreamPackagesDir, e.name, 'package.json')))
    .map((e) => e.name)
    .sort()
}

function syncInto(upstreamRoot, destPackagesDir) {
  const upstreamPackagesDir = path.join(upstreamRoot, 'packages')
  const names = listUpstreamPackages(upstreamPackagesDir)

  if (fs.existsSync(destPackagesDir)) {
    for (const entry of fs.readdirSync(destPackagesDir)) {
      if (entry === 'UPSTREAM.json') continue
      fs.rmSync(path.join(destPackagesDir, entry), { recursive: true })
    }
  } else {
    fs.mkdirSync(destPackagesDir, { recursive: true })
  }

  const vendored = []
  for (const name of names) {
    const src = path.join(upstreamPackagesDir, name)
    const dest = path.join(destPackagesDir, name)
    copyPackageTree(src, dest)
    const pkgName = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).name
    transformPackageJson(dest, name, pkgName.startsWith('@layernorm/'))
    rewriteOutOfPackageImports(dest)
    rewriteZodCompat(dest)
    fixTsconfigInclude(dest)
    const vendoredPkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
    vendored.push({ dir: name, name: pkgName, version: vendoredPkg.version })
  }
  inlineSharedCopies(upstreamRoot, destPackagesDir)
  for (const name of names) {
    // Shared copies land inside package dirs after the per-package pass, so
    // run the compat rewrite once more over the packages that received them.
    const dest = path.join(destPackagesDir, name)
    rewriteZodCompat(dest)
  }

  const manifest = {
    upstream: 'LayerNorm/overlay-web',
    sha: upstreamSha(upstreamRoot),
    syncedAt: new Date().toISOString(),
    packages: vendored
  }
  fs.writeFileSync(path.join(destPackagesDir, 'UPSTREAM.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeViteAliases(destPackagesDir, vendored)
  return manifest
}

// electron-vite resolves vendored packages through a tsconfig-style alias
// table, not package exports. Generate the table from each package's exports
// map so subpath imports never drift from upstream. Subpath aliases are
// emitted before bare package aliases because Vite does prefix matching in
// object order ('@overlay/ui' would otherwise capture '@overlay/ui/chat').
function writeViteAliases(destPackagesDir, vendored) {
  const subpathAliases = []
  const rootAliases = []
  for (const pkg of vendored) {
    const pkgJsonPath = path.join(destPackagesDir, pkg.dir, 'package.json')
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    const exportsMap = pkgJson.exports ?? { '.': pkgJson.main ?? './src/index.ts' }
    for (const [subpath, rawTarget] of Object.entries(exportsMap)) {
      const target =
        typeof rawTarget === 'string'
          ? rawTarget
          : rawTarget.import ?? rawTarget.default ?? rawTarget.types
      if (typeof target !== 'string' || target.startsWith('./dist/')) continue
      const aliasKey = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`
      const entry = [aliasKey, `packages/${pkg.dir}/${target.replace(/^\.\//, '')}`]
      if (subpath === '.') rootAliases.push(entry)
      else subpathAliases.push(entry)
    }
  }
  subpathAliases.sort(([a], [b]) => a.localeCompare(b))
  rootAliases.sort(([a], [b]) => a.localeCompare(b))
  const aliases = Object.fromEntries([...subpathAliases, ...rootAliases])
  fs.writeFileSync(
    path.join(destPackagesDir, 'vite-aliases.json'),
    `${JSON.stringify(aliases, null, 2)}\n`
  )
}

function updateRootDevDeps(manifest) {
  const pkgJsonPath = path.join(repoRoot, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  pkg.devDependencies = pkg.devDependencies ?? {}
  let changed = false
  for (const { name, version } of manifest.packages) {
    if (pkg.devDependencies[name] !== version) {
      pkg.devDependencies[name] = version
      changed = true
    }
  }
  if (changed) {
    pkg.devDependencies = Object.fromEntries(
      Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b))
    )
    fs.writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
  }
  return changed
}

function diffTrees(a, b, rel = '') {
  const diffs = []
  const entriesA = fs.existsSync(a) ? fs.readdirSync(a, { withFileTypes: true }) : []
  const entriesB = fs.existsSync(b) ? fs.readdirSync(b, { withFileTypes: true }) : []
  const names = new Set([...entriesA.map((e) => e.name), ...entriesB.map((e) => e.name)])
  for (const name of [...names].sort()) {
    if (SKIP_ENTRIES.has(name)) continue
    const pa = path.join(a, name)
    const pb = path.join(b, name)
    const relPath = rel ? `${rel}/${name}` : name
    const ea = entriesA.find((e) => e.name === name)
    const eb = entriesB.find((e) => e.name === name)
    if (!ea) {
      diffs.push(`only in packages/: ${relPath}`)
      continue
    }
    if (!eb) {
      diffs.push(`missing from packages/: ${relPath}`)
      continue
    }
    if (ea.isDirectory() && eb.isDirectory()) {
      diffs.push(...diffTrees(pa, pb, relPath))
    } else if (ea.isFile() && eb.isFile()) {
      if (Buffer.compare(fs.readFileSync(pa), fs.readFileSync(pb)) !== 0) {
        diffs.push(`differs: ${relPath}`)
      }
    } else {
      diffs.push(`type mismatch: ${relPath}`)
    }
  }
  return diffs
}

const args = parseArgs(process.argv)
const upstreamPackagesDir = resolveUpstreamDir(args.upstream)
const upstreamRoot = path.dirname(upstreamPackagesDir)

if (args.check) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-vendor-check-'))
  try {
    const destPackagesDir = path.join(tmp, 'packages')
    syncInto(upstreamRoot, destPackagesDir)
    // UPSTREAM.json.syncedAt always differs; compare the rest.
    const diffs = diffTrees(destPackagesDir, path.join(repoRoot, 'packages')).filter(
      (d) => !d.startsWith('differs: UPSTREAM.json') && !d.includes('UPSTREAM.json')
    )
    if (diffs.length > 0) {
      console.error('packages/ is out of sync with upstream:')
      for (const d of diffs.slice(0, 50)) console.error(`  ${d}`)
      if (diffs.length > 50) console.error(`  …and ${diffs.length - 50} more`)
      process.exit(1)
    }
    console.log('packages/ is in sync with upstream.')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
} else {
  const manifest = syncInto(upstreamRoot, path.join(repoRoot, 'packages'))
  const depsChanged = updateRootDevDeps(manifest)
  console.log(
    `Vendored ${manifest.packages.length} packages from ${manifest.upstream}@${manifest.sha.slice(0, 10)}` +
      (depsChanged ? ' (root devDependencies updated)' : '')
  )
}
