#!/usr/bin/env node
/**
 * Generate src/api/schema.d.ts from the backend's OpenAPI schema (issue #587).
 *
 * The schema comes straight from the FastAPI app via
 * backend/scripts/export_openapi.py, so no server needs to be running - only
 * the backend's Python dependencies. openapi-typescript turns it into the
 * `paths` / `components` / `operations` types that src/api.ts builds on.
 *
 *   npm run api:types         regenerate the file
 *   npm run api:types:check   fail if the committed file is stale (CI runs this)
 *
 * A backend change that alters a request or response shape therefore shows up
 * as a diff to schema.d.ts in the same PR, and tsc flags any frontend code that
 * no longer fits it.
 *
 * Set $PYTHON to choose the interpreter (default: python3).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(FRONTEND, '..')
const OUT = resolve(FRONTEND, 'src/api/schema.d.ts')
const EXPORTER = resolve(REPO, 'backend/scripts/export_openapi.py')

const HEADER = `/**
 * GENERATED FILE - do not edit by hand.
 *
 * The backend's OpenAPI schema as TypeScript types, produced by
 * scripts/generate-api-types.mjs. Regenerate with \`npm run api:types\` after
 * changing a backend route or schema; CI fails while this file is stale.
 */

`

function exportSchema() {
  const python = process.env.PYTHON || 'python3'
  // Startup logging goes to stderr; let it through so a failure is diagnosable.
  const json = execFileSync(python, [EXPORTER], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(json)
}

async function generate() {
  // A field with a default is optional in a request but always present in a
  // response. Pydantic already says so - its output schemas list defaulted
  // fields as required - so don't let openapi-typescript make every defaulted
  // field required on the way in too.
  const ast = await openapiTS(exportSchema(), { defaultNonNullable: false })
  return HEADER + astToString(ast)
}

async function main() {
  const check = process.argv.includes('--check')
  const generated = await generate()
  const rel = relative(FRONTEND, OUT)

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null
    if (current === generated) {
      console.log(`✓ api-types: ${rel} matches the backend schema.`)
      return
    }
    console.error(
      `✗ api-types: ${rel} is ${current === null ? 'missing' : 'stale'}.\n` +
        '  The backend OpenAPI schema changed. Run "npm run api:types" in frontend/ and commit the result.'
    )
    process.exit(1)
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, generated)
  console.log(`✓ api-types: wrote ${rel}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
