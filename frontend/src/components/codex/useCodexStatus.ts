import { useEffect, useState } from 'react'
import api from '../../api'
import type { Schema } from '../../api'

type CodexStatus = Schema<'CodexStatus'>

// Whether Grimoire Codex DB is configured and on, and where it lives. Same for
// every book and system, so one request answers for the whole session; settings
// changes clear it.
let pending: Promise<CodexStatus> | null = null
let settled: CodexStatus | null = null

/** Forget the cached status — call after changing the Grimoire Codex DB settings. */
export function clearCodexStatusCache(): void {
  pending = null
  settled = null
}

function load(): Promise<CodexStatus> {
  if (!pending) {
    pending = api
      .get('/codex/status')
      .then((s: CodexStatus) => {
        settled = s
        return s
      })
      .catch((e) => {
        // An offline blip must not hide Grimoire Codex DB for the rest of the session.
        pending = null
        throw e
      })
  }
  return pending
}

/**
 * `{ enabled, url }`, or null while loading or when the request fails.
 * `enabled` is false unless the server has GRIMOIRE_CODEX_DB_API_TOKEN set; nothing about
 * Grimoire Codex DB is shown then.
 */
export default function useCodexStatus(): CodexStatus | null {
  const [status, setStatus] = useState<CodexStatus | null>(settled)
  useEffect(() => {
    if (settled) return undefined
    let active = true
    load()
      .then((s) => active && setStatus(s))
      .catch(() => active && setStatus(null))
    return () => {
      active = false
    }
  }, [])
  return status
}
