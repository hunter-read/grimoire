import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('accessToken', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('drops a copy an older build left in localStorage', async () => {
    localStorage.setItem('grimoire_token', 'left-over')
    await import('./accessToken')
    expect(localStorage.getItem('grimoire_token')).toBeNull()
  })

  it('holds the token in memory only', async () => {
    const { getAccessToken, setAccessToken } = await import('./accessToken')
    expect(getAccessToken()).toBeNull()
    setAccessToken('abc')
    expect(getAccessToken()).toBe('abc')
    expect(localStorage.getItem('grimoire_token')).toBeNull()
    setAccessToken(null)
    expect(getAccessToken()).toBeNull()
  })
})

describe('refreshAccessToken across tabs', () => {
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')

  afterEach(() => {
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
    else delete (navigator as { locks?: unknown }).locks
    vi.restoreAllMocks()
  })

  it('runs the refresh inside a Web Lock when the browser has them', async () => {
    vi.resetModules()
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn())
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'fresh' }),
    }) as unknown as typeof fetch
    const { refreshAccessToken } = await import('./client')
    const { getAccessToken } = await import('./accessToken')
    await expect(refreshAccessToken()).resolves.toBe('fresh')
    expect(request).toHaveBeenCalledWith('grimoire-token-refresh', expect.any(Function))
    expect(getAccessToken()).toBe('fresh')
  })
})
