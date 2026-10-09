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

const STATUS = { enabled: true, url: 'https://codex.test', can_submit: true }

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
  it('renders nothing while GrimoireCodexDB is turned off', async () => {
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

  it('links to the GrimoireCodexDB record and unlinks', async () => {
    api.delete.mockResolvedValue({ status: 'ok' })
    const onLinkChange = renderPanel({ codexId: 'bk_abc123' })
    const link = await screen.findByRole('link', { name: /view on GrimoireCodexDB/i })
    expect(link).toHaveAttribute('href', 'https://codex.test/books/bk_abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    expect(api.delete).toHaveBeenCalledWith('/codex/books/b1/link')
    await waitFor(() => expect(onLinkChange).toHaveBeenCalledWith(null))
  })

  it('adds an unlinked book once a source is given, and links it when applied', async () => {
    api.post.mockResolvedValue({
      status: 'applied',
      codex_id: 'bk_new001',
      linked: true,
      edit_url: 'https://codex.test/edits/ed_1',
    })
    const onLinkChange = renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Add to GrimoireCodexDB' }))
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Where is this from?'), 'My PDF')
    await userEvent.click(send)
    expect(api.post).toHaveBeenCalledWith('/codex/books/b1/submit', { note: 'My PDF' })
    expect(await screen.findByRole('status')).toHaveTextContent('Sent and live on GrimoireCodexDB.')
    expect(screen.getByRole('link', { name: 'View the edit' })).toHaveAttribute(
      'href',
      'https://codex.test/edits/ed_1'
    )
    expect(onLinkChange).toHaveBeenCalledWith('bk_new001')
  })

  it('sends only the chosen fields as a correction', async () => {
    api.post.mockResolvedValue({
      status: 'pending',
      codex_id: 'bk_abc123',
      linked: true,
      edit_url: 'https://codex.test/edits/ed_2',
    })
    const onLinkChange = renderPanel({ codexId: 'bk_abc123' })
    await userEvent.click(await screen.findByRole('button', { name: 'Send corrections' }))
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Page count'))
    await userEvent.click(screen.getByLabelText('ISBN'))
    await userEvent.click(screen.getByLabelText('ISBN'))
    await userEvent.click(send)
    expect(api.post).toHaveBeenCalledWith('/codex/books/b1/submit', {
      fields: ['page_count'],
      note: '',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('waits for review')
    expect(onLinkChange).not.toHaveBeenCalled()
  })

  it('shows the error GrimoireCodexDB returned and can be cancelled', async () => {
    api.post.mockRejectedValue(new Error('Name is required'))
    renderPanel({ kind: 'systems' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add to GrimoireCodexDB' }))
    expect(screen.getByText(/creates the system/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Where is this from?'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('reports a failed unlink', async () => {
    api.delete.mockRejectedValue(new Error('Book not found'))
    const onLinkChange = renderPanel({ codexId: 'bk_abc123' })
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Book not found')
    expect(onLinkChange).not.toHaveBeenCalled()
  })

  it('offers no sending without a token', async () => {
    api.get.mockResolvedValue({ ...STATUS, can_submit: false })
    renderPanel()
    expect(await screen.findByText(/Not linked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to GrimoireCodexDB' })).not.toBeInTheDocument()
  })

  it('asks GrimoireCodexDB for its status once per session', async () => {
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
