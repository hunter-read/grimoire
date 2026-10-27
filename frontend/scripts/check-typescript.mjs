#!/usr/bin/env node
/**
 * Keeps frontend/src all TypeScript (issue #587).
 *
 * The frontend was converted from JavaScript a file at a time; it is finished,
 * so this fails if any .js/.jsx file - tests included - exists under src/,
 * whether committed, staged or untracked. tsc would not notice one: a JavaScript
 * file nothing imports is simply not part of the program.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run git with args passed as an array (no shell).
function git(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim()
}

/** Repo-relative paths of the .js/.jsx files under frontend/src, ignored files excluded. */
export function javascriptFiles(root) {
  const listed = git(
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'frontend/src'],
    root
  )
  return [...new Set(listed.split('\n').filter(Boolean))]
    .filter((p) => /\.(js|jsx)$/.test(p))
    .filter((p) => existsSync(join(root, p)))
    .sort()
}

function main() {
  const root = git(['rev-parse', '--show-toplevel'])
  const found = javascriptFiles(root)
  if (!found.length) {
    console.log('✓ check-typescript: frontend/src has no JavaScript files.')
    return
  }
  for (const path of found) console.error(`✗ ${path}`)
  console.error(
    `\n✗ check-typescript: ${found.length} JavaScript file(s) under frontend/src.\n` +
      '  Rename each to .ts/.tsx and make "npm run typecheck" pass. See docs/typescript.md.'
  )
  process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
