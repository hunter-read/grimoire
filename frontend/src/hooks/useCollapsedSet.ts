import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY = new Set()

function storageFor(kind) {
  return kind === 'local' ? localStorage : sessionStorage
}

function read(kind, key) {
  try {
    const raw = storageFor(kind).getItem(key)
    return raw === null ? null : new Set(JSON.parse(raw))
  } catch {
    return null
  }
}

function write(kind, key, set) {
  try {
    storageFor(kind).setItem(key, JSON.stringify([...set]))
  } catch {
    // Storage unavailable (private mode); the choice stays in memory only.
  }
}

/**
 * A Set of collapsed group keys, persisted under `key`, that falls back to a
 * computed default until the user makes a choice.
 *
 * Nothing is stored until the user toggles something, so `defaultCollapsed`
 * can depend on data that arrives after mount (how many items a page holds) and
 * still apply. The first toggle stores the whole resulting set, after which the
 * stored choice wins over the default.
 *
 * @param {string}  key                storage key
 * @param {Set}     [defaultCollapsed] collapsed keys while no choice is stored
 * @param {object}  [opts]
 * @param {'session'|'local'} [opts.storage='session'] which Web Storage to use
 * @returns [collapsed, setCollapsed] - setCollapsed takes a Set or an updater
 */
export default function useCollapsedSet(
  key,
  defaultCollapsed = EMPTY,
  { storage = 'session' } = {}
) {
  const [state, setState] = useState(() => ({ key, chosen: read(storage, key) }))

  // A new key (e.g. navigating between systems on the same route) starts from
  // whatever that key has stored, not the previous key's choice.
  let current = state
  if (state.key !== key) {
    current = { key, chosen: read(storage, key) }
    setState(current)
  }

  const defaultRef = useRef(defaultCollapsed)
  useEffect(() => {
    defaultRef.current = defaultCollapsed
  })

  const setCollapsed = useCallback(
    (next) =>
      setState((prev) => {
        const base = prev.chosen ?? defaultRef.current
        const value = new Set(typeof next === 'function' ? next(base) : next)
        write(storage, prev.key, value)
        return { key: prev.key, chosen: value }
      }),
    [storage]
  )

  return [current.chosen ?? defaultCollapsed, setCollapsed]
}
