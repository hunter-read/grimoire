import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import McpConsentView from './McpConsentView'
import { apiKeys, mcpSignIns } from '../api'
import type { Schema } from '../api'
import { sendBrowserTo } from '../utils/sendBrowserTo'

vi.mock('../api', () => ({
  apiKeys: { permissions: vi.fn() },
  mcpSignIns: { get: vi.fn(), approve: vi.fn(), deny: vi.fn() },
}))
vi.mock('../utils/sendBrowserTo', () => ({ sendBrowserTo: vi.fn() }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, username: 'scott', role: 'gm' } }),
}))

const httpError = (status: number, message = String(status)) =>
  Object.assign(new Error(message), { status })

const signIn = (overrides: Partial<Schema<'OAuthRequestOut'>> = {}): Schema<'OAuthRequestOut'> => ({
  client_name: 'Claude',
  redirect_host: 'claude.ai',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  may_approve: true,
  reason: null,
  default_permissions: { '*': 'read' },
  levels: { books: ['none', 'read', 'write'] },
  ...overrides,
})

const permissions = [
  {
    id: 'books',
    group: 'library',
    tags: ['books'],
    description: 'books',
    levels: ['none', 'read', 'write'],
  },
] as Schema<'ApiKeyPermissionOut'>[]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiKeys.permissions).mockResolvedValue(permissions)
})

describe('McpConsentView', () => {
  it('names the app, the account and, prominently, the host it returns to', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    render(<McpConsentView requestId="r1" />)
    expect(await screen.findByText('Claude wants to use your Grimoire library')).toBeInTheDocument()
    expect(screen.getByText('Signed in as scott')).toBeInTheDocument()
    expect(screen.getByTestId('consent-host')).toHaveTextContent('claude.ai')
    expect(mcpSignIns.get).toHaveBeenCalledWith('r1')
  })

  it('shows the host next to both buttons', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    render(<McpConsentView requestId="r1" />)
    const allow = await screen.findByRole('button', { name: 'Allow' })
    const deny = screen.getByRole('button', { name: 'Deny' })
    for (const button of [allow, deny]) {
      expect(button).toHaveAccessibleDescription('Either answer sends you to claude.ai.')
    }
  })

  it('defaults to read-only and approves with the server default', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    vi.mocked(mcpSignIns.approve).mockResolvedValue({ redirect_to: 'https://claude.ai/cb?code=c' })
    render(<McpConsentView requestId="r1" />)
    expect(await screen.findByText('Read only (recommended)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(sendBrowserTo).toHaveBeenCalledWith('https://claude.ai/cb?code=c'))
    expect(mcpSignIns.approve).toHaveBeenCalledWith('r1', null)
    expect(apiKeys.permissions).not.toHaveBeenCalled()
  })

  it('sends the chosen permissions after Customize', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    vi.mocked(mcpSignIns.approve).mockResolvedValue({ redirect_to: 'https://claude.ai/cb' })
    render(<McpConsentView requestId="r1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    fireEvent.click(await screen.findByRole('button', { name: /Library/ }))
    const books = screen.getByRole('combobox', { name: 'Books' })
    fireEvent.change(books, { target: { value: 'write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() =>
      expect(mcpSignIns.approve).toHaveBeenCalledWith('r1', { '*': 'read', books: 'write' })
    )
  })

  it('denies and returns to the app', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    vi.mocked(mcpSignIns.deny).mockResolvedValue({
      redirect_to: 'https://claude.ai/cb?error=access_denied',
    })
    render(<McpConsentView requestId="r1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(sendBrowserTo).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied')
    )
    expect(mcpSignIns.approve).not.toHaveBeenCalled()
  })

  it('sends one answer however fast the buttons are clicked', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    vi.mocked(mcpSignIns.approve).mockReturnValue(new Promise(() => {}))
    render(<McpConsentView requestId="r1" />)
    const allow = await screen.findByRole('button', { name: 'Allow' })
    const deny = screen.getByRole('button', { name: 'Deny' })
    fireEvent.click(allow)
    fireEvent.click(allow)
    fireEvent.click(deny)
    expect(mcpSignIns.approve).toHaveBeenCalledTimes(1)
    expect(mcpSignIns.deny).not.toHaveBeenCalled()
    await waitFor(() => expect(allow).toBeDisabled())
    expect(deny).toBeDisabled()
  })

  it('offers only Deny, with the reason, to a user who may not hold keys', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(
      signIn({ may_approve: false, reason: 'API keys are not enabled for your account' })
    )
    render(<McpConsentView requestId="r1" />)
    expect(await screen.findByRole('note')).toHaveTextContent(
      'API keys are not enabled for your account'
    )
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull()
    const deny = screen.getByRole('button', { name: 'Deny' })
    expect(deny).toBeEnabled()
    // With Deny the only answer, the destination line names it rather than
    // saying "either answer".
    expect(deny).toHaveAccessibleDescription('Deny sends you to claude.ai.')
  })

  it('opens Customize with every group folded, as All permissions = Read sets no area', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    render(<McpConsentView requestId="r1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Customize' }))
    const library = await screen.findByRole('button', { name: /Library/ })
    expect(library).toHaveAttribute('aria-expanded', 'false')
    expect(library).toHaveTextContent('1 of 1 with access')
  })

  it('says an expired or answered request is gone, with no buttons', async () => {
    vi.mocked(mcpSignIns.get).mockRejectedValue(httpError(404))
    render(<McpConsentView requestId="r1" />)
    expect(await screen.findByText("This sign-in request isn't available")).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('treats a missing request id as gone without asking the server', () => {
    render(<McpConsentView requestId={null} />)
    expect(screen.getByText("This sign-in request isn't available")).toBeInTheDocument()
    expect(mcpSignIns.get).not.toHaveBeenCalled()
  })

  it("shows the server's reason when the request can't be loaded", async () => {
    vi.mocked(mcpSignIns.get).mockRejectedValue(httpError(403, 'Guests cannot do this'))
    render(<McpConsentView requestId="r1" />)
    expect(await screen.findByText("Couldn't load this sign-in request")).toBeInTheDocument()
    expect(screen.getByText('Guests cannot do this')).toBeInTheDocument()
  })

  it('says the request is gone when it expires before the answer', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    vi.mocked(mcpSignIns.approve).mockRejectedValue(httpError(404))
    render(<McpConsentView requestId="r1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByText("This sign-in request isn't available")).toBeInTheDocument()
    expect(sendBrowserTo).not.toHaveBeenCalled()
  })

  it('shows a failed answer and lets the user try again', async () => {
    vi.mocked(mcpSignIns.get).mockResolvedValue(signIn())
    vi.mocked(mcpSignIns.approve)
      .mockRejectedValueOnce(httpError(403, 'API keys are not enabled for your account'))
      .mockResolvedValueOnce({ redirect_to: 'https://claude.ai/cb' })
    render(<McpConsentView requestId="r1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('API keys are not enabled')
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(sendBrowserTo).toHaveBeenCalledWith('https://claude.ai/cb'))
  })
})
