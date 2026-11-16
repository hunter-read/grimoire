import { describe, it, expect } from 'vitest'
import { browserEmbedsPdf } from './pdfEmbed'

const nav = (over: Partial<Navigator>) =>
  ({ userAgent: '', maxTouchPoints: 0, pdfViewerEnabled: true, ...over }) as Navigator

const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

describe('browserEmbedsPdf', () => {
  it('trusts a desktop browser with a PDF viewer', () => {
    expect(browserEmbedsPdf(nav({ userAgent: DESKTOP_CHROME }))).toBe(true)
    expect(browserEmbedsPdf(nav({ userAgent: MAC_SAFARI }))).toBe(true)
  })

  it('believes a browser that says it has no PDF viewer', () => {
    expect(browserEmbedsPdf(nav({ userAgent: DESKTOP_CHROME, pdfViewerEnabled: false }))).toBe(
      false
    )
  })

  it('treats an older browser that does not say as able to', () => {
    expect(browserEmbedsPdf(nav({ userAgent: DESKTOP_CHROME, pdfViewerEnabled: undefined }))).toBe(
      true
    )
  })

  it.each([
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile'],
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'],
  ])('rules out %s, even when it claims a viewer', (_name, userAgent) => {
    expect(browserEmbedsPdf(nav({ userAgent }))).toBe(false)
  })

  it('sees through an iPad asking for the desktop site', () => {
    expect(browserEmbedsPdf(nav({ userAgent: MAC_SAFARI, maxTouchPoints: 5 }))).toBe(false)
  })

  it('reads the real navigator by default', () => {
    // jsdom is a desktop-like browser that declares no viewer either way.
    expect(browserEmbedsPdf()).toBe(true)
  })
})
