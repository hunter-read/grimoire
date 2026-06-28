#!/usr/bin/env node
/**
 * Per-changed-file coverage gate.
 *
 * Fails if any changed frontend source file (src/**.{js,jsx}, excluding tests)
 * has line coverage below MIN_PCT. This enforces the "each change brings
 * coverage up" goal without imposing a hard global threshold in vite.config.js.
 *
 * Strict by design: a changed source file that is absent from the coverage
 * report (i.e. has no test exercising it at all) is treated as 0% and fails.
 *
 * Reads coverage/coverage-summary.json — run `npm run test:coverage` first.
 *
 * Base ref for the diff comes from $BASE_REF (CI sets this), falling back to
 * origin/main, then main. Override the threshold with $MIN_COVERAGE.
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const MIN_PCT = Number(process.env.MIN_COVERAGE || 80)
const SUMMARY_PATH = resolve(process.cwd(), 'coverage/coverage-summary.json')

function sh(cmd, cwd) {
  return execSync(cmd, { encoding: 'utf8', cwd }).trim()
}

function repoRoot() {
  return sh('git rev-parse --show-toplevel')
}

// Pick the first base ref that git can resolve.
function resolveBase(root) {
  const candidates = [process.env.BASE_REF, 'origin/main', 'main'].filter(Boolean)
  for (const ref of candidates) {
    try {
      sh(`git rev-parse --verify --quiet ${ref}^{commit}`, root)
      return ref
    } catch {
      // try next
    }
  }
  return null
}

function gitLines(cmd, root) {
  try {
    return sh(cmd, root).split('\n')
  } catch {
    return []
  }
}

// Source files (under frontend/src) changed vs the base, excluding test files.
// Unions three changesets so it works both in CI and locally before committing:
//   1. committed changes the branch introduces (base...HEAD, PR semantics),
//   2. uncommitted tracked changes (git diff HEAD),
//   3. untracked new files.
// Returns absolute paths so they match the coverage-summary keys.
function changedSourceFiles(base, root) {
  const files = new Set([
    ...gitLines(`git diff --name-only --diff-filter=ACMR ${base}...HEAD -- frontend/src`, root),
    ...gitLines('git diff --name-only --diff-filter=ACMR HEAD -- frontend/src', root),
    ...gitLines('git ls-files --others --exclude-standard -- frontend/src', root),
  ])
  return [...files]
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => /\.(js|jsx)$/.test(p))
    .filter((p) => !/\.test\.(js|jsx)$/.test(p))
    .filter((p) => !p.startsWith('frontend/src/test/'))
    .map((p) => resolve(root, p))
}

function main() {
  const root = repoRoot()
  const base = resolveBase(root)
  if (!base) {
    console.warn('⚠ check-coverage: no base ref resolvable; skipping gate.')
    return
  }

  const changed = changedSourceFiles(base, root)
  if (changed.length === 0) {
    console.log(`✓ check-coverage: no changed frontend source files vs ${base}.`)
    return
  }

  if (!existsSync(SUMMARY_PATH)) {
    console.error(`✗ check-coverage: ${SUMMARY_PATH} not found. Run "npm run test:coverage" first.`)
    process.exit(1)
  }
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'))

  const failures = []
  const passes = []
  for (const file of changed) {
    const entry = summary[file]
    const pct = entry?.lines?.pct
    // Absent from the report = untested = 0% (strict).
    const value = typeof pct === 'number' ? pct : 0
    const rel = file.replace(`${root}/`, '')
    if (value < MIN_PCT) failures.push({ rel, pct: value, untested: entry === undefined })
    else passes.push({ rel, pct: value })
  }

  for (const p of passes) console.log(`✓ ${p.pct.toFixed(2)}%  ${p.rel}`)
  for (const f of failures) {
    const note = f.untested ? ' (no coverage — needs tests)' : ''
    console.error(`✗ ${f.pct.toFixed(2)}%  ${f.rel}${note}`)
  }

  if (failures.length) {
    console.error(
      `\n✗ check-coverage: ${failures.length} changed file(s) below ${MIN_PCT}% line coverage.`
    )
    process.exit(1)
  }
  console.log(`\n✓ check-coverage: all ${passes.length} changed file(s) ≥ ${MIN_PCT}%.`)
}

main()
