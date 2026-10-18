#!/usr/bin/env node
/**
 * Per-changed-file coverage gate.
 *
 * Fails if any changed frontend source file (src/**.{js,jsx,ts,tsx}, excluding
 * tests and type declarations)
 * has line coverage below MIN_PCT. This enforces the "each change brings
 * coverage up" goal without imposing a hard global threshold in vite.config.js.
 *
 * Strict by design: a changed source file that is absent from the coverage
 * report (i.e. has no test exercising it at all) is treated as 0% and fails -
 * unless it holds no runtime code at all (only types, or only re-exports), which
 * the report leaves out because there is nothing in it to cover.
 *
 * Reads coverage/coverage-summary.json — run `npm run test:coverage` first.
 *
 * Base ref for the diff comes from $BASE_REF (CI sets this), falling back to
 * origin/main, then main. Override the threshold with $MIN_COVERAGE.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const MIN_PCT = Number(process.env.MIN_COVERAGE || 80)
const SUMMARY_PATH = resolve(process.cwd(), 'coverage/coverage-summary.json')

// Run git with args passed as an array (no shell), so values derived from
// untrusted input (e.g. a PR branch name in BASE_REF) can never be interpreted
// as shell syntax.
function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim()
}

function gitLines(args, cwd) {
  try {
    return git(args, cwd).split('\n')
  } catch {
    return []
  }
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel'])
}

// Pick the first base ref that git can resolve.
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

// Source files (under frontend/src) changed vs the base, excluding test files.
// Unions three changesets so it works both in CI and locally before committing:
//   1. committed changes the branch introduces (base...HEAD, PR semantics),
//   2. uncommitted tracked changes (git diff HEAD),
//   3. untracked new files.
// Returns absolute paths so they match the coverage-summary keys.
function changedSourceFiles(base, root) {
  const files = new Set([
    ...gitLines(
      ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`, '--', 'frontend/src'],
      root
    ),
    ...gitLines(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--', 'frontend/src'], root),
    ...gitLines(['ls-files', '--others', '--exclude-standard', '--', 'frontend/src'], root),
  ])
  return (
    [...files]
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => /\.(js|jsx|ts|tsx)$/.test(p))
      .filter((p) => !/\.d\.ts$/.test(p))
      .filter((p) => !/\.test\.(js|jsx|ts|tsx)$/.test(p))
      .filter((p) => !p.startsWith('frontend/src/test/'))
      // Mirror the coverage `exclude` globs in vite.config.js so files that are
      // intentionally not instrumented (entry point, third-party setup glue,
      // config) aren't flagged as 0%.
      .filter((p) => p !== 'frontend/src/main.jsx')
      .filter((p) => !p.startsWith('frontend/src/lib/'))
      .filter((p) => !/\.config\.(js|jsx|ts|tsx)$/.test(p))
      .map((p) => resolve(root, p))
      // A file the branch added and then deleted is still "changed" against the
      // base, but there is nothing left to cover. `--diff-filter` cannot express
      // this: the add is in base...HEAD while the delete is only in the working
      // tree, so the two never cancel out.
      .filter((p) => existsSync(p))
  )
}

// Whether a TypeScript file compiles to nothing but module wiring - imports and
// re-exports - so it has no statements a test could execute. Asks the compiler
// rather than guessing from the source: types, interfaces and `import type`
// vanish in the emitted JavaScript.
function hasNoRuntimeCode(file) {
  if (!/\.(ts|tsx)$/.test(file)) return false
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  })
  const source = ts.createSourceFile('out.js', outputText, ts.ScriptTarget.ES2022)
  return source.statements.every(
    (node) =>
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) &&
        (node.moduleSpecifier || !node.exportClause?.elements.length))
  )
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
  const skipped = []
  for (const file of changed) {
    const entry = summary[file]
    if (entry === undefined && hasNoRuntimeCode(file)) {
      skipped.push(file.replace(`${root}/`, ''))
      continue
    }
    const pct = entry?.lines?.pct
    // Absent from the report = untested = 0% (strict).
    const value = typeof pct === 'number' ? pct : 0
    const rel = file.replace(`${root}/`, '')
    if (value < MIN_PCT) failures.push({ rel, pct: value, untested: entry === undefined })
    else passes.push({ rel, pct: value })
  }

  for (const rel of skipped) console.log(`-  no runtime code  ${rel}`)
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
