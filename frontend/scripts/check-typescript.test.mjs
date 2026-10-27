// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { javascriptFiles } from './check-typescript.mjs'

const FRONTEND_DIR = resolve(import.meta.dirname, '..')

// A throwaway repo laid out like this one, so the real git listing is exercised.
describe('check-typescript', () => {
  let repo

  function git(...args) {
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
      { cwd: repo }
    )
  }

  function write(path, body = 'export const x = 1\n') {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), body)
  }

  function run() {
    return spawnSync('node', ['scripts/check-typescript.mjs'], {
      cwd: join(repo, 'frontend'),
      encoding: 'utf8',
    })
  }

  beforeEach(() => {
    // Resolved, as git reports it (macOS's tmpdir sits behind a symlink).
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'check-typescript-')))
    mkdirSync(join(repo, 'frontend/scripts'), { recursive: true })
    copyFileSync(
      join(FRONTEND_DIR, 'scripts/check-typescript.mjs'),
      join(repo, 'frontend/scripts/check-typescript.mjs')
    )
    write('frontend/src/main.tsx')
    write('frontend/src/lib/util.ts')
    write('frontend/vite.config.js')
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('passes when src is all TypeScript, ignoring JavaScript outside src', () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no JavaScript files')
  })

  it('fails on committed, untracked and test JavaScript files under src', () => {
    write('frontend/src/old.jsx')
    git('add', '.')
    git('commit', '-q', '-m', 'js')
    write('frontend/src/lib/new.js')
    write('frontend/src/lib/new.test.js')

    expect(javascriptFiles(repo)).toEqual([
      'frontend/src/lib/new.js',
      'frontend/src/lib/new.test.js',
      'frontend/src/old.jsx',
    ])
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('✗ frontend/src/old.jsx')
    expect(result.stderr).toContain('3 JavaScript file(s)')
  })

  it('skips ignored files and files deleted from the working tree', () => {
    write('frontend/src/gone.js')
    git('add', '.')
    git('commit', '-q', '-m', 'js')
    rmSync(join(repo, 'frontend/src/gone.js'))
    writeFileSync(join(repo, '.gitignore'), 'node_modules\nbuild.js\n')
    write('frontend/src/build.js')

    expect(javascriptFiles(repo)).toEqual([])
    expect(run().status).toBe(0)
  })
})
