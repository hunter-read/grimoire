import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodexSection from './CodexSection'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

const api = (await import('../../api')).default

const SETTINGS = {
  enabled: true,
  url: 'https://db.grimoirecodex.org',
  can_submit: false,
  send_hashes: false,
  has_token: false,
  locked: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.get.mockResolvedValue(SETTINGS)
  api.put.mockImplementation((_url, patch) => {
    const next = { ...SETTINGS, ...patch }
    if ('api_token' in patch) next.has_token = !!patch.api_token
    delete next.api_token
    return Promise.resolve(next)
  })
})

describe('CodexSection', () => {
  it('turns lookup off', async () => {
    render(<CodexSection />)
    const toggle = await screen.findByLabelText('Look up metadata in Grimoire Codex')
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    expect(api.put).toHaveBeenCalledWith('/codex/settings', { enabled: false })
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('saves the address on blur only when it changed', async () => {
    render(<CodexSection />)
    const url = await screen.findByLabelText('Codex address')
    await userEvent.click(url)
    await userEvent.tab()
    expect(api.put).not.toHaveBeenCalled()
    await userEvent.clear(url)
    await userEvent.type(url, 'http://codex.lan:8787{Enter}')
    expect(api.put).toHaveBeenCalledWith('/codex/settings', { url: 'http://codex.lan:8787' })
  })

  it('opts in to sending hashes', async () => {
    render(<CodexSection />)
    await userEvent.click(await screen.findByLabelText('Send file hashes when looking up books'))
    expect(api.put).toHaveBeenCalledWith('/codex/settings', { send_hashes: true })
  })

  it('saves the token write-only and can remove it', async () => {
    render(<CodexSection />)
    const input = await screen.findByLabelText('API token')
    expect(screen.getByRole('button', { name: 'Save token' })).toBeDisabled()
    await userEvent.type(input, 'cdx_secret')
    await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
    expect(api.put).toHaveBeenCalledWith('/codex/settings', { api_token: 'cdx_secret' })
    await waitFor(() => expect(input).toHaveValue(''))
    expect(input).toHaveAttribute('placeholder', expect.stringMatching(/token is saved/))
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    expect(api.put).toHaveBeenLastCalledWith('/codex/settings', { api_token: '' })
  })

  it('shows settings pinned by the environment as read-only', async () => {
    api.get.mockResolvedValue({ ...SETTINGS, locked: ['enabled', 'url', 'api_token'] })
    render(<CodexSection />)
    expect(await screen.findByLabelText('Look up metadata in Grimoire Codex')).toBeDisabled()
    expect(screen.getByLabelText('Codex address')).toBeDisabled()
    expect(screen.getByText('Set by CODEX_API_TOKEN in the environment.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save token' })).not.toBeInTheDocument()
  })

  it('tests the connection', async () => {
    api.post.mockResolvedValueOnce({
      ok: true,
      url: 'x',
      account: { name: 'Hunter', role: 'editor' },
    })
    render(<CodexSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Connected as Hunter (editor)')

    api.post.mockResolvedValueOnce({ ok: true, url: 'x', account: null })
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Add a token')

    api.post.mockRejectedValueOnce(new Error('Could not reach Grimoire Codex'))
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach')
  })

  it('reports a rejected save and a failed load', async () => {
    api.put.mockRejectedValueOnce(new Error('The Codex URL must be an http(s) address'))
    const { unmount } = render(<CodexSection />)
    await userEvent.click(await screen.findByLabelText('Send file hashes when looking up books'))
    expect(await screen.findByRole('alert')).toHaveTextContent('http(s) address')
    unmount()

    api.get.mockRejectedValueOnce(new Error('Forbidden'))
    render(<CodexSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
  })
})
