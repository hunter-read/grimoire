import { useCallback, useEffect, useState } from 'react'
import api from '../api'

/** The browse views a pin can belong to. */
export type PinCollection = 'systems' | 'maps' | 'tokens' | 'audio' | 'models'

export interface Pin {
  id: string
  collection: string
  target: string
}

export interface PinsHandle {
  /** This view's pins, oldest first. */
  pins: Pin[]
  isPinned: (target: string) => boolean
  /** Pin `target`, or unpin it when it is pinned. */
  toggle: (target: string) => Promise<void>
}

/**
 * The current user's pins for one view: folders (the galleries) or game
 * systems (the library) kept one click away.
 *
 * Toggling updates the strip at once and puts it back if the server refuses,
 * so a pin never claims to be saved when it was not.
 */
export default function usePins(collection: PinCollection): PinsHandle {
  const [pins, setPins] = useState<Pin[]>([])

  useEffect(() => {
    let current = true
    api
      .get(`/pins?collection=${collection}`)
      .then((body) => {
        if (current) setPins(((body as { pins?: Pin[] } | null)?.pins || []) as Pin[])
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [collection])

  const isPinned = useCallback((target: string) => pins.some((p) => p.target === target), [pins])

  const toggle = useCallback(
    async (target: string) => {
      const existing = pins.find((p) => p.target === target)
      if (existing) {
        setPins((prev) => prev.filter((p) => p.id !== existing.id))
        try {
          await api.delete(`/pins/${existing.id}`)
        } catch {
          setPins((prev) => (prev.some((p) => p.id === existing.id) ? prev : [...prev, existing]))
        }
        return
      }
      try {
        const pin = (await api.post('/pins', { collection, target })) as Pin
        setPins((prev) => (prev.some((p) => p.id === pin.id) ? prev : [...prev, pin]))
      } catch {
        // Nothing was added, so there is nothing to put back.
      }
    },
    [pins, collection]
  )

  return { pins, isPinned, toggle }
}
