import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodexPanel from './CodexPanel'
import { clearCodexStatusCache } from './useCodexStatus'
import { codexFieldLabel, CODEX_FIELDS } from './codexFields'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const api = (await import('../../api')).default

const STATUS = { enabled: true, url: 'https://codex.test' }

function renderPanel(props = {}) {
  const onLinkChange = vi.fn()
  render(
    <CodexPanel
      kind="books"
      resourceId="b1"
      codexId={null}
      onLinkChange={onLinkChange}
      {...props}
    />
  )
  return onLinkChange
}

beforeEach(() => {
  vi.clearAllMocks()
  clearCodexStatusCache()
  api.get.mockResolvedValue(STATUS)
})

describe('CodexPanel', () => {
  it('renders nothing while Grimoire Codex DB is turned off', async () => {
    api.get.mockResolvedValue({ ...STATUS, enabled: false })
    const { container } = render(<CodexPanel kind="books" resourceId="b1" codexId={null} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/codex/status'))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the status cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    const { container } = render(<CodexPanel kind="books" resourceId="b1" codexId={null} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('links to the Grimoire Codex DB record and unlinks', async () => {
    api.delete.mockResolvedValue({ status: 'ok' })
    const onLinkChange = renderPanel({ codexId: 'bk_abc123' })
    const link = await screen.findByRole('link', { name: /view on Grimoire Codex DB/i })
    expect(link).toHaveAttribute('href', 'https://codex.test/books/bk_abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    expect(api.delete).toHaveBeenCalledWith('/codex/books/b1/link')
    await waitFor(() => expect(onLinkChange).toHaveBeenCalledWith(null))
  })

  it('opens the send form and reports what was sent', async () => {
    api.get.mockImplementation((url) =>
      Promise.resolve(
        url === '/codex/status'
          ? STATUS
          : {
              linked: false,
              fields: [
                { field: 'title', local: 'Dead Planet', remote: null, status: 'only_local' },
              ],
              cover: { local: false, remote_url: null, status: 'none' },
              attribution_sources: [],
              system: null,
            }
      )
    )
    api.post.mockResolvedValue({
      status: 'applied',
      codex_id: 'bk_new001',
      linked: true,
      edit_url: 'https://codex.test/edits/ed_1',
    })
    const onLinkChange = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Add to Grimoire Codex DB' }))
    expect(api.get).toHaveBeenCalledWith('/codex/books/b1/compare')
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Sent and live on Grimoire Codex DB.'
    )
    expect(screen.getByRole('link', { name: 'View the edit' })).toHaveAttribute(
      'href',
      'https://codex.test/edits/ed_1'
    )
    expect(onLinkChange).toHaveBeenCalledWith('bk_new001')
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('says when a book waits for its new system, and when a correction waits', async () => {
    api.get.mockImplementation((url) =>
      Promise.resolve(
        url === '/codex/status'
          ? STATUS
          : {
              linked: true,
              revision: 2,
              fields: [{ field: 'page_count', local: 44, remote: 40, status: 'differs' }],
              cover: { local: false, remote_url: null, status: 'none' },
              attribution_sources: [],
              system: null,
            }
      )
    )
    api.post.mockResolvedValueOnce({
      status: 'waiting_for_system',
      codex_id: null,
      linked: false,
      edit_url: 'https://codex.test/edits/ed_3',
    })
    const onLinkChange = renderPanel({ codexId: 'bk_abc123' })
    await userEvent.click(await screen.findByRole('button', { name: 'Send corrections' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Send this book once it is approved'
    )

    api.post.mockResolvedValueOnce({
      status: 'pending',
      codex_id: 'bk_abc123',
      linked: true,
      edit_url: 'https://codex.test/edits/ed_4',
    })
    await userEvent.click(screen.getByRole('button', { name: 'Send corrections' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('status')).toHaveTextContent('waits for review')
    expect(onLinkChange).not.toHaveBeenCalled()
  })

  it('closes the send form on cancel', async () => {
    api.get.mockImplementation((url) =>
      url === '/codex/status' ? Promise.resolve(STATUS) : Promise.reject(new Error('Offline'))
    )
    renderPanel({ kind: 'systems' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add to Grimoire Codex DB' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Grimoire Codex DB' })).toBeInTheDocument()
  })

  it('reports a failed unlink', async () => {
    api.delete.mockRejectedValue(new Error('Book not found'))
    const onLinkChange = renderPanel({ codexId: 'bk_abc123' })
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Book not found')
    expect(onLinkChange).not.toHaveBeenCalled()
  })

  it('asks Grimoire Codex DB for its status once per session', async () => {
    const first = render(<CodexPanel kind="books" resourceId="b1" codexId={null} />)
    await screen.findByText(/Not linked/)
    first.unmount()
    render(<CodexPanel kind="books" resourceId="b2" codexId={null} />)
    await screen.findByText(/Not linked/)
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})

describe('codexFieldLabel', () => {
  const t = (key, fallback) => (key === 'systemEditor.edition' ? 'Edition' : fallback)
  it('uses editor labels and falls back to the field name', () => {
    expect(codexFieldLabel(t, 'systems', 'edition')).toBe('Edition')
    expect(codexFieldLabel(t, 'systems', 'unknown_field')).toBe('unknown_field')
    expect(CODEX_FIELDS.books).toContain('page_count')
  })
})
