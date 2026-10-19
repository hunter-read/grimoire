import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetupView from './SetupView'
import { clearPasswordRulesCache } from '../hooks/usePasswordRules'

interface FakeResponse {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
  text?: () => Promise<string>
}

const respond = (body: unknown, ok = true, status = ok ? 200 : 422): FakeResponse => ({
  ok,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
})

const STATUS = { initialized: false, password_min_length: 12, share_link_password_min_length: 8 }

/**
 * fetch as the setup screen sees it: GET /api/auth/status answers with the
 * password minimums, and POST /api/auth/setup with `setup` (a response, or a
 * rejection for an unreachable server).
 */
function mockFetch(setup?: FakeResponse | Error, status: object = STATUS) {
  globalThis.fetch = vi.fn((url: string) => {
    if (url === '/api/auth/status') return Promise.resolve(respond(status))
    if (setup instanceof Error) return Promise.reject(setup)
    return Promise.resolve(setup ?? respond({ token: 't', user: {} }))
  }) as unknown as typeof fetch
}

const setupCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/auth/setup')

async function fillAndSubmit(password: string, confirm = password, username = 'admin') {
  await userEvent.type(screen.getByLabelText('Username'), username)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.type(screen.getByLabelText('Confirm Password'), confirm)
  fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
}

describe('SetupView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    clearPasswordRulesCache()
    mockFetch()
  })

  it('renders the First-Time Setup heading', () => {
    render(<SetupView onSetup={vi.fn()} />)
    expect(screen.getByText('First-Time Setup')).toBeInTheDocument()
  })

  it('renders username, password, and confirm password fields', () => {
    render(<SetupView onSetup={vi.fn()} />)
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
  })

  it('shows an error when passwords do not match', async () => {
    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('password1', 'password2')
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
  })

  it('does not send the setup request when passwords mismatch', async () => {
    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('aaa', 'bbb')
    expect(setupCalls()).toHaveLength(0)
  })

  it('requires 12 characters by default', async () => {
    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('elevenchars')
    expect(screen.getByText('Password must be at least 12 characters.')).toBeInTheDocument()
    expect(setupCalls()).toHaveLength(0)
  })

  it("uses the server's minimum when it has been changed", async () => {
    mockFetch(undefined, { ...STATUS, password_min_length: 6 })
    const onSetup = vi.fn()
    render(<SetupView onSetup={onSetup} />)

    // Too short under either minimum, so submitting again until the server's
    // number shows never sends the setup request.
    await fillAndSubmit('short', 'short')
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
      expect(screen.getByText('Password must be at least 6 characters.')).toBeInTheDocument()
    })
    expect(setupCalls()).toHaveLength(0)

    // Six characters is enough on this server.
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sixsix' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'sixsix' } })
    fireEvent.click(screen.getByRole('button', { name: /create admin account/i }))
    await waitFor(() => expect(setupCalls()).toHaveLength(1))
  })

  it('calls onSetup with token and user on successful account creation', async () => {
    mockFetch(respond({ token: 'tok', user: { username: 'admin', role: 'admin' } }))
    const onSetup = vi.fn()

    render(<SetupView onSetup={onSetup} />)
    await fillAndSubmit('securepassword')

    await waitFor(() =>
      expect(onSetup).toHaveBeenCalledWith('tok', { username: 'admin', role: 'admin' })
    )
  })

  it('sends trimmed username to the API', async () => {
    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('securepassword', 'securepassword', '  admin  ')

    await waitFor(() => expect(setupCalls()).toHaveLength(1))
    const init = setupCalls()[0][1] as RequestInit
    expect(JSON.parse(String(init.body)).username).toBe('admin')
  })

  it('shows the server error detail when setup fails', async () => {
    mockFetch(respond({ detail: 'Already initialized' }, false, 409))

    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('securepassword')

    expect(await screen.findByText('Already initialized')).toBeInTheDocument()
  })

  it("shows the server's reason when it refuses a password as too common", async () => {
    mockFetch(
      respond(
        {
          detail: [
            {
              loc: ['body', 'password'],
              msg: 'Value error, That password is too common - choose one that is harder to guess',
              type: 'value_error',
            },
          ],
        },
        false,
        422
      )
    )

    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('password1234')

    expect(
      await screen.findByText('That password is too common - choose one that is harder to guess')
    ).toBeInTheDocument()
  })

  it('shows a generic error when the server is unreachable', async () => {
    mockFetch(new Error('Network error'))

    render(<SetupView onSetup={vi.fn()} />)
    await fillAndSubmit('securepassword')

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument()
  })
})
