import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches React.lazy's own bound
type AnyComponent = ComponentType<any>

export type PreloadableComponent<T extends AnyComponent> = LazyExoticComponent<T> & {
  /** Start fetching the component's chunk now, so rendering it later doesn't wait. */
  preload: () => Promise<unknown>
}

/**
 * `React.lazy`, plus a `preload()` that fetches the same chunk ahead of the first
 * render - on hover, say. Both share one request. A failed fetch is forgotten,
 * so the next attempt tries again rather than replaying the failure.
 */
export default function lazyWithPreload<T extends AnyComponent>(
  load: () => Promise<{ default: T }>
): PreloadableComponent<T> {
  let pending: Promise<{ default: T }> | undefined
  const once = () =>
    (pending ??= load().catch((err: unknown) => {
      pending = undefined
      throw err
    }))
  return Object.assign(lazy(once), { preload: once })
}
