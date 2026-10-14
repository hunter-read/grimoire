import { describe, it, expect, vi } from 'vitest'
import { copyText, publicUrl, STATE_TONE, EXPIRY_OPTIONS } from './shareLinkUtils'

describe('publicUrl', () => {
  const lan = { hostname: '192.168.1.5', origin: 'http://192.168.1.5:9481' }

  it('swaps an unconfigured localhost BASE_URL for the address in use', () => {
    expect(publicUrl('http://localhost:9481/share/tok', lan)).toBe(
      'http://192.168.1.5:9481/share/tok'
    )
    expect(publicUrl('http://127.0.0.1:9481/api/share/tok/a.png?x=1', lan)).toBe(
      'http://192.168.1.5:9481/api/share/tok/a.png?x=1'
    )
  })

  it('keeps a configured BASE_URL', () => {
    expect(publicUrl('https://grimoire.example.com/share/tok', lan)).toBe(
      'https://grimoire.example.com/share/tok'
    )
  })

  it('keeps localhost when the page is on localhost too', () => {
    const local = { hostname: 'localhost', origin: 'http://localhost:5173' }
    expect(publicUrl('http://localhost:9481/share/tok', local)).toBe(
      'http://localhost:9481/share/tok'
    )
  })

  it('leaves a relative or broken URL alone', () => {
    expect(publicUrl('/share/tok', lan)).toBe('/share/tok')
  })
})

describe('copyText', () => {
  it('reports success and failure', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue() },
      configurable: true,
    })
    expect(await copyText('x')).toBe(true)
    navigator.clipboard.writeText.mockRejectedValue(new Error('no'))
    expect(await copyText('x')).toBe(false)
  })
})

describe('constants', () => {
  it('colours every state and offers a never option', () => {
    expect(Object.keys(STATE_TONE)).toEqual(
      expect.arrayContaining(['active', 'revoked', 'expired', 'suspended', 'unavailable'])
    )
    expect(EXPIRY_OPTIONS.at(-1)).toEqual({ value: '', key: 'never' })
    expect(EXPIRY_OPTIONS.map((o) => o.value)).toEqual(['1', '7', '30', '90', '365', ''])
  })
})
