#!/usr/bin/env node
/**
 * TypeScript ratchet (issue #587): the frontend's JavaScript only shrinks.
 *
 * Fails if, compared with the base branch, a change under src/:
 *   - adds a .js/.jsx file (tests included - write new ones in TypeScript), or
 *   - modifies or moves a non-test .js/.jsx file. Convert it while you are in
 *     there: rename it to .ts/.tsx and make `npm run typecheck` pass.
 *
 * A modified .js/.jsx *test* is allowed: tests convert along with the module
 * they cover, so touching the test of a JavaScript module does not force it.
 *
 * Mirrors the backend's mypy `disallow_untyped_defs` overrides. Like
 * check-coverage.mjs, the base ref comes from $BASE_REF (CI sets it), falling
 * back to origin/dev, then dev, and the check covers committed, uncommitted and
 * untracked changes.
 */
import { execFileSync } from 'node:child_process'

// Run git with args passed as an array (no shell), so a value derived from
// untrusted input (a PR branch name in BASE_REF) is never read as shell syntax.
function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim()
}

function gitLines(args, cwd) {
  try {
    return git(args, cwd).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function resolveBase(root) {
  const candidates = [process.env.BASE_REF, 'origin/dev', 'dev'].filter(Boolean)
  for (const ref of candidates) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root)
      return ref
    } catch {
      // try next
    }
  }
  return null
}

const isJs = (p) => /\.(js|jsx)$/.test(p)
const isTest = (p) => /\.test\.(js|jsx)$/.test(p) || p.startsWith('frontend/src/test/')

/**
 * `git diff --name-status` lines as {status, path}: A(dded), M(odified),
 * R(enamed, with `path` the new name) or C(opied). Deletions are dropped.
 */
function parseStatus(lines) {
  return lines
    .map((line) => line.split('\t'))
    .map(([status, ...paths]) => ({ status: status[0], path: paths[paths.length - 1] }))
    .filter(({ status }) => 'AMRC'.includes(status))
}

/** Changes under frontend/src vs the base: committed, uncommitted, and untracked. */
function changes(base, root) {
  const diff = (range) =>
    parseStatus(gitLines(['diff', '--name-status', '-M', ...range, '--', 'frontend/src'], root))
  const byPath = new Map()
  // An add anywhere wins over a later modify: the file is new to the base.
  for (const change of [...diff([`${base}...HEAD`]), ...diff(['HEAD'])]) {
    if (byPath.get(change.path)?.status !== 'A') byPath.set(change.path, change)
  }
  for (const path of gitLines(
    ['ls-files', '--others', '--exclude-standard', '--', 'frontend/src'],
    root
  )) {
    byPath.set(path, { status: 'A', path })
  }
  return [...byPath.values()]
}

function main() {
  const root = git(['rev-parse', '--show-toplevel'])
  const base = resolveBase(root)
  if (!base) {
    console.warn('⚠ check-typescript: no base ref resolvable; skipping.')
    return
  }

  const failures = []
  for (const { status, path } of changes(base, root)) {
    if (!isJs(path)) continue
    if (status === 'A' || status === 'C') failures.push({ path, why: 'new file' })
    else if (!isTest(path)) failures.push({ path, why: status === 'R' ? 'moved' : 'modified' })
  }

  if (!failures.length) {
    console.log(`✓ check-typescript: no new or modified JavaScript under frontend/src vs ${base}.`)
    return
  }
  for (const { path, why } of failures) console.error(`✗ ${path} (${why})`)
  console.error(
    `\n✗ check-typescript: ${failures.length} file(s) must be TypeScript.\n` +
      '  Rename each to .ts/.tsx and make "npm run typecheck" pass. See docs/typescript.md.'
  )
  process.exit(1)
}

main()
