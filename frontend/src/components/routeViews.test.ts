import { describe, expect, it, vi } from 'vitest'
import { MapsView, SettingsView, preloadRoute } from './routeViews'

describe('preloadRoute', () => {
  it('preloads the view a sidebar destination opens', () => {
    const preload = vi.spyOn(MapsView, 'preload').mockResolvedValue({})
    preloadRoute('/maps')
    expect(preload).toHaveBeenCalledTimes(1)
  })

  it('matches on the first path segment', () => {
    const preload = vi.spyOn(SettingsView, 'preload').mockResolvedValue({})
    preloadRoute('/settings/account')
    expect(preload).toHaveBeenCalledTimes(1)
  })

  it('ignores a path it has no view for', () => {
    expect(() => preloadRoute('/nowhere')).not.toThrow()
    expect(() => preloadRoute('')).not.toThrow()
  })

  it('swallows a failed fetch, leaving the navigation to retry it', async () => {
    vi.spyOn(MapsView, 'preload').mockRejectedValue(new Error('offline'))
    preloadRoute('/maps')
    // An unhandled rejection would fail the run; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
