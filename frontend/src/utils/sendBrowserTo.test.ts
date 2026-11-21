import { describe, it, expect } from 'vitest'
import { sendBrowserTo } from './sendBrowserTo'

describe('sendBrowserTo', () => {
  // jsdom can't leave the page, but it does follow a same-page address, which
  // shows the browser was sent where it was told.
  it('sends the browser to the address given', () => {
    sendBrowserTo('#consent-answered')
    expect(window.location.hash).toBe('#consent-answered')
  })
})
