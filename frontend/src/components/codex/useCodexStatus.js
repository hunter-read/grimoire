import { useEffect, useState } from 'react'
import api from '../../api'

// Whether GrimoireCodexDB is on, where it lives and whether records can be sent. Same for
// every book and system, so one request answers for the whole session; settings
// changes clear it.
let pending = null
let settled = null

/** Forget the cached status — call after changing the GrimoireCodexDB settings. */
export function clearCodexStatusCache() {
  pending = null
  settled = null
}

function load() {
  if (!pending) {
    pending = api
      .get('/codex/status')
      .then((s) => {
        settled = s
        return s
      })
      .catch((e) => {
        // An offline blip must not hide GrimoireCodexDB for the rest of the session.
        pending = null
        throw e
      })
  }
  return pending
}

/** `{ enabled, url, can_submit }`, or null while loading or when unavailable. */
export default function useCodexStatus() {
  const [status, setStatus] = useState(settled)
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
