import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY = new Set<never>()

/** Which Web Storage the choice lives in. */
export type CollapsedStorage = 'session' | 'local'

/** A Set, or an updater from the current one; what `setCollapsed` takes. */
export type CollapsedUpdate<K> = Iterable<K> | ((prev: Set<K>) => Iterable<K>)

function storageFor(kind: CollapsedStorage): Storage {
  return kind === 'local' ? localStorage : sessionStorage
}

function read<K>(kind: CollapsedStorage, key: string): Set<K> | null {
  try {
    const raw = storageFor(kind).getItem(key)
    return raw === null ? null : new Set<K>(JSON.parse(raw))
  } catch {
    return null
  }
}

function write<K>(kind: CollapsedStorage, key: string, set: Set<K>): void {
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
export default function useCollapsedSet<K = string>(
  key: string,
  defaultCollapsed: Set<K> = EMPTY,
  { storage = 'session' }: { storage?: CollapsedStorage } = {}
): [Set<K>, (next: CollapsedUpdate<K>) => void] {
  const [state, setState] = useState(() => ({ key, chosen: read<K>(storage, key) }))

  // A new key (e.g. navigating between systems on the same route) starts from
  // whatever that key has stored, not the previous key's choice.
  let current = state
  if (state.key !== key) {
    current = { key, chosen: read<K>(storage, key) }
    setState(current)
  }

  const defaultRef = useRef(defaultCollapsed)
  useEffect(() => {
    defaultRef.current = defaultCollapsed
  })

  const setCollapsed = useCallback(
    (next: CollapsedUpdate<K>) =>
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
