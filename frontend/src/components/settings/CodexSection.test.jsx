import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodexSection from './CodexSection'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

const api = (await import('../../api')).default

const SETTINGS = {
  url: 'https://db.grimoirecodex.org',
  send_hashes: false,
  locked: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.get.mockResolvedValue(SETTINGS)
  api.put.mockImplementation((_url, patch) => Promise.resolve({ ...SETTINGS, ...patch }))
})

describe('CodexSection', () => {
  it('saves the address on blur only when it changed', async () => {
    render(<CodexSection />)
    const url = await screen.findByLabelText('Grimoire Codex DB address')
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

  it('says the token comes from the environment and offers no way to change it', async () => {
    render(<CodexSection />)
    expect(
      await screen.findByText(/Uses the API token set in GRIMOIRE_CODEX_DB_API_TOKEN/)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument()
  })

  it('shows settings pinned by the environment as read-only', async () => {
    api.get.mockResolvedValue({ ...SETTINGS, locked: ['url', 'send_hashes'] })
    render(<CodexSection />)
    expect(await screen.findByLabelText('Grimoire Codex DB address')).toBeDisabled()
    expect(screen.getByLabelText('Send file hashes when looking up books')).toBeDisabled()
    expect(screen.getByText('Set by GRIMOIRE_CODEX_DB_URL in the environment.')).toBeInTheDocument()
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
    expect(await screen.findByRole('status')).toHaveTextContent(/^Connected\.$/)

    api.post.mockRejectedValueOnce(new Error('Could not reach Grimoire Codex DB'))
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach')
  })

  it('reports a rejected save and a failed load', async () => {
    api.put.mockRejectedValueOnce(new Error('The Grimoire Codex DB URL must be an http(s) address'))
    const { unmount } = render(<CodexSection />)
    await userEvent.click(await screen.findByLabelText('Send file hashes when looking up books'))
    expect(await screen.findByRole('alert')).toHaveTextContent('http(s) address')
    unmount()

    api.get.mockRejectedValueOnce(new Error('Forbidden'))
    render(<CodexSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
  })
})
