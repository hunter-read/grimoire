// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkFiles, measuredFiles } from './check-coverage.mjs'

const FRONTEND_DIR = resolve(import.meta.dirname, '..')
const ROOT = resolve(FRONTEND_DIR, '..')
const abs = (p) => resolve(ROOT, p)

describe('measuredFiles', () => {
  it('gates src/lib/ files other than the two vendor wrappers', () => {
    expect(
      measuredFiles(
        [
          'frontend/src/lib/uvtt.ts',
          'frontend/src/lib/tokenCompositor.ts',
          'frontend/src/lib/pdfjs.ts',
          'frontend/src/lib/three.ts',
        ],
        ROOT
      )
    ).toEqual([abs('frontend/src/lib/uvtt.ts'), abs('frontend/src/lib/tokenCompositor.ts')])
  })

  it('skips the files the coverage report leaves out', () => {
    expect(
      measuredFiles(
        [
          'frontend/src/main.tsx',
          'frontend/src/lib/uvtt.test.ts',
          'frontend/src/api/schema.d.ts',
          'frontend/src/test/fakeBrowseApi.ts',
        ],
        ROOT
      )
    ).toEqual([])
  })

  it('drops blank lines, duplicates and files that no longer exist', () => {
    expect(
      measuredFiles(
        ['', ' frontend/src/lib/uvtt.js ', 'frontend/src/lib/uvtt.ts', 'frontend/src/lib/gone.ts'],
        ROOT
      )
    ).toEqual([abs('frontend/src/lib/uvtt.ts')])
  })
})

describe('checkFiles', () => {
  const file = abs('frontend/src/lib/uvtt.ts')

  it('fails a file below the threshold and passes one at or above it', () => {
    expect(checkFiles([file], { [file]: { lines: { pct: 50 } } }, ROOT, 80).failures).toEqual([
      { rel: 'frontend/src/lib/uvtt.ts', pct: 50, untested: false },
    ])
    expect(checkFiles([file], { [file]: { lines: { pct: 80 } } }, ROOT, 80).passes).toEqual([
      { rel: 'frontend/src/lib/uvtt.ts', pct: 80 },
    ])
  })

  it('counts a file missing from the report as untested', () => {
    expect(checkFiles([file], {}, ROOT, 80).failures).toEqual([
      { rel: 'frontend/src/lib/uvtt.ts', pct: 0, untested: true },
    ])
  })
})

// Runs the real script against a throwaway repo laid out like this one, so the
// whole path - git diff, glob matching, the summary lookup, the exit code - is
// exercised.
describe('npm run coverage:check', () => {
  let repo

  beforeEach(() => {
    // Resolved, as git reports it (macOS's tmpdir sits behind a symlink).
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'check-coverage-')))
    const scripts = join(repo, 'frontend/scripts')
    mkdirSync(scripts, { recursive: true })
    mkdirSync(join(repo, 'frontend/src/lib'), { recursive: true })
    for (const name of ['check-coverage.mjs', 'coverage-files.mjs']) {
      copyFileSync(join(FRONTEND_DIR, 'scripts', name), join(scripts, name))
    }
    symlinkSync(join(FRONTEND_DIR, 'node_modules'), join(repo, 'frontend/node_modules'))
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  function git(...args) {
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: repo }
    )
  }

  // Adds src/lib/<name> at `pct` line coverage, then runs the gate.
  function changeLibFile(name, pct) {
    const file = join(repo, 'frontend/src/lib', name)
    writeFileSync(file, 'export const answer = () => 42\n')
    mkdirSync(join(repo, 'frontend/coverage'))
    writeFileSync(
      join(repo, 'frontend/coverage/coverage-summary.json'),
      JSON.stringify({ [file]: { lines: { pct } } })
    )
    return spawnSync('node', ['scripts/check-coverage.mjs'], {
      cwd: join(repo, 'frontend'),
      env: { ...process.env, BASE_REF: 'main', MIN_COVERAGE: '80' },
      encoding: 'utf8',
    })
  }

  it('fails when a changed src/lib/ file is under-covered', () => {
    const result = changeLibFile('helpers.ts', 50)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('50.00%  frontend/src/lib/helpers.ts')
  })

  it('passes a well-covered src/lib/ file', () => {
    const result = changeLibFile('helpers.ts', 95)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('95.00%  frontend/src/lib/helpers.ts')
  })

  it('ignores the vendor wrappers', () => {
    const result = changeLibFile('pdfjs.ts', 0)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no changed frontend source files')
  })
})
