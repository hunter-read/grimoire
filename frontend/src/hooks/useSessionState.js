import { useState, useEffect, useRef } from 'react'

/**
 * Like useState, but the value is persisted in sessionStorage so it survives
 * in-session navigation (e.g. going to a detail view and coming back).
 * Values reset on a full page reload, which is the correct default.
 *
 * Supports plain values and Set objects.
 * Sets are stored as JSON arrays and rehydrated as Sets on load.
 *
 * @param {string} key        sessionStorage key
 * @param {*}      initial    initial value (used only when no stored value exists)
 * @returns [value, setValue] — same API as useState
 */
export default function useSessionState(key, initial) {
  const isSet = initial instanceof Set

  const [value, setValueRaw] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw === null) return initial
      const parsed = JSON.parse(raw)
      return isSet ? new Set(parsed) : parsed
    } catch {
      return initial
    }
  })

  // Track whether the value has been explicitly set at least once (i.e. data loaded).
  const hasBeenSet = useRef(value !== initial)

  const setValue = (next) => {
    hasBeenSet.current = true
    setValueRaw(next)
  }

  useEffect(() => {
    if (!hasBeenSet.current) return
    try {
      const toStore = value instanceof Set ? [...value] : value
      sessionStorage.setItem(key, JSON.stringify(toStore))
    } catch {}
  }, [key, value])

  return [value, setValue]
}
