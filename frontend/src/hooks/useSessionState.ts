import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

/**
 * Like useState, but the value is persisted in sessionStorage so it survives
 * in-session navigation (e.g. going to a detail view and coming back).
 * Values reset on a full page reload, which is the correct default.
 *
 * Supports plain values and Set objects.
 * Sets are stored as JSON arrays and rehydrated as Sets on load.
 *
 * Pass `restore: false` to start from `initial` and store it straight away,
 * replacing what an earlier visit left — used by views that persist state only
 * for a return trip (see useRestoredView). A fresh navigation starts clean, and
 * a later return reads back this visit's state. Storing only on change left an
 * untouched visit's predecessor in place, so returning from a book opened off
 * the shelf brought back a search the user had made on an earlier visit.
 *
 * @param {string} key        sessionStorage key
 * @param {*}      initial    initial value (used only when no stored value exists)
 * @param {object} [opts]
 * @param {boolean} [opts.restore=true] whether to seed from the stored value
 * @returns [value, setValue] — same API as useState
 */
export interface SessionStateOptions {
  /** Whether to seed from the stored value (default true). */
  restore?: boolean
}

const store = (key: string, value: unknown): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value instanceof Set ? [...value] : value))
  } catch {}
}

export default function useSessionState<T>(
  key: string,
  initial: T,
  { restore = true }: SessionStateOptions = {}
): [T, Dispatch<SetStateAction<T>>] {
  const isSet = initial instanceof Set

  const [value, setValueRaw] = useState<T>(() => {
    if (!restore) return initial
    try {
      const raw = sessionStorage.getItem(key)
      if (raw === null) return initial
      const parsed: unknown = JSON.parse(raw)
      return isSet ? (new Set(parsed as Iterable<unknown>) as T) : (parsed as T)
    } catch {
      return initial
    }
  })

  // Track whether the value has been explicitly set at least once (i.e. data
  // loaded). Object defaults (Set/array/object) are never reference-equal to a
  // rehydrated value, so compare on identity only for primitives — otherwise a
  // fresh mount would immediately write its own default back to storage.
  const hasBeenSet = useRef(typeof initial === 'object' ? false : value !== initial)

  const setValue = (next: SetStateAction<T>) => {
    hasBeenSet.current = true
    setValueRaw(next)
  }

  // Once, for the key this mount started with: a fresh visit's starting value
  // replaces the previous visit's (see `restore` above).
  useEffect(() => {
    if (!restore) store(key, initial)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hasBeenSet.current) return
    store(key, value)
  }, [key, value])

  return [value, setValue]
}
