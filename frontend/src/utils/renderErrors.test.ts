import { describe, it, expect, vi, afterEach } from 'vitest'
import { logRenderError } from './renderErrors'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logRenderError', () => {
  it('logs the error with its kind, the page, and the component stack', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')
    logRenderError('uncaught')(error, { componentStack: '\n    at Broken' })
    expect(consoleError).toHaveBeenCalledWith(
      `Grimoire: uncaught render error on ${window.location.pathname}`,
      error,
      '\n    at Broken'
    )
  })

  it('logs an empty stack when React gives none', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    logRenderError('caught')('thrown string', {})
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('caught'),
      'thrown string',
      ''
    )
  })
})
