import { describe, it, expect } from 'vitest'
import { sanitizeLoginMessage } from './sanitizeLoginMessage'

describe('sanitizeLoginMessage', () => {
  it('returns empty string for empty/falsy input', () => {
    expect(sanitizeLoginMessage('')).toBe('')
    expect(sanitizeLoginMessage(null)).toBe('')
    expect(sanitizeLoginMessage(undefined)).toBe('')
  })

  it('keeps allowed inline tags', () => {
    const out = sanitizeLoginMessage('<b>bold</b> <i>i</i> <s>s</s>')
    expect(out).toContain('<b>bold</b>')
    expect(out).toContain('<i>i</i>')
    expect(out).toContain('<s>s</s>')
  })

  it('keeps lists', () => {
    const out = sanitizeLoginMessage('<ul><li>a</li></ul>')
    expect(out).toContain('<ul>')
    expect(out).toContain('<li>a</li>')
  })

  it('strips disallowed tags but keeps text content', () => {
    const out = sanitizeLoginMessage('<span>hi</span>')
    expect(out).not.toContain('<span')
    expect(out).toContain('hi')
  })

  it('strips event handlers', () => {
    const out = sanitizeLoginMessage('<b onclick="x()">x</b>')
    expect(out).not.toContain('onclick')
    expect(out).toContain('<b>x</b>')
  })

  it('rejects javascript: hrefs but keeps the anchor text', () => {
    const out = sanitizeLoginMessage('<a href="javascript:alert(1)">bad</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('href=')
    expect(out).toContain('bad')
  })

  it('keeps safe http/https links and adds rel/target', () => {
    const out = sanitizeLoginMessage('<a href="https://example.com">x</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('noopener')
    expect(out).toContain('target="_blank"')
  })

  it('drops script tags entirely', () => {
    // Note: the browser DOMParser drops <script> from <body> automatically,
    // and our sanitizer additionally enforces the allowlist. The result must
    // not contain anything executable.
    const out = sanitizeLoginMessage('<b>ok</b><script>bad()</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('bad()')
    expect(out).toContain('<b>ok</b>')
  })
})
