import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import usePasswordRules, {
  DEFAULT_PASSWORD_RULES,
  clearPasswordRulesCache,
  rememberAuthStatus,
} from './usePasswordRules'
import { AuthProvider, useAuth } from '../context/AuthContext'

// The real API client, with fetch answering GET /api/auth/status.
function statusResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response
}

function Rules() {
  const { passwordMinLength, shareLinkPasswordMinLength } = usePasswordRules()
  return <span data-testid="rules">{`${passwordMinLength}/${shareLinkPasswordMinLength}`}</span>
}

const statusCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/auth/status')

beforeEach(() => {
  vi.restoreAllMocks()
  clearPasswordRulesCache()
})

describe('usePasswordRules', () => {
  it('shows the defaults until the server answers, then the server minimums', async () => {
    let answer: (value: unknown) => void = () => {}
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    ) as unknown as typeof fetch
    render(<Rules />)
    expect(screen.getByTestId('rules')).toHaveTextContent('12/8')
    await waitFor(() => expect(statusCalls()).toHaveLength(1))
    expect(screen.getByTestId('rules')).toHaveTextContent('12/8')

    answer(
      statusResponse({
        initialized: true,
        password_min_length: 16,
        share_link_password_min_length: 6,
      })
    )
    await waitFor(() => expect(screen.getByTestId('rules')).toHaveTextContent('16/6'))
  })

  it('asks the server once for every form on the page', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      statusResponse({
        initialized: true,
        password_min_length: 14,
        share_link_password_min_length: 10,
      })
    )
    render(
      <>
        <Rules />
        <Rules />
      </>
    )
    await waitFor(() =>
      screen.getAllByTestId('rules').forEach((el) => expect(el).toHaveTextContent('14/10'))
    )
    expect(statusCalls()).toHaveLength(1)

    // A form opened later reuses the answer.
    render(<Rules />)
    expect(screen.getAllByTestId('rules')[2]).toHaveTextContent('14/10')
    expect(statusCalls()).toHaveLength(1)
  })

  it('keeps the defaults when the status cannot be read, and tries again next time', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    const { unmount } = render(<Rules />)
    await waitFor(() => expect(statusCalls()).toHaveLength(1))
    expect(screen.getByTestId('rules')).toHaveTextContent('12/8')
    unmount()

    vi.mocked(fetch).mockResolvedValue(
      statusResponse({
        initialized: true,
        password_min_length: 9,
        share_link_password_min_length: 5,
      })
    )
    render(<Rules />)
    await waitFor(() => expect(screen.getByTestId('rules')).toHaveTextContent('9/5'))
  })

  it('falls back to a default for a value that is missing or not a positive whole number', () => {
    globalThis.fetch = vi.fn()
    rememberAuthStatus({ initialized: true, password_min_length: 0 })
    render(<Rules />)
    expect(screen.getByTestId('rules')).toHaveTextContent(
      `${DEFAULT_PASSWORD_RULES.passwordMinLength}/${DEFAULT_PASSWORD_RULES.shareLinkPasswordMinLength}`
    )
  })

  it('reuses the status AuthProvider already fetched instead of asking again', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      statusResponse({
        initialized: false,
        password_min_length: 20,
        share_link_password_min_length: 11,
      })
    )
    // Like App: the setup and settings forms appear once the auth status is known.
    function AfterAuth() {
      const auth = useAuth()
      return auth?.status === 'loading' ? null : <Rules />
    }
    render(
      <AuthProvider>
        <AfterAuth />
      </AuthProvider>
    )
    expect(await screen.findByTestId('rules')).toHaveTextContent('20/11')
    expect(statusCalls()).toHaveLength(1)
  })
})
