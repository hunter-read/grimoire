import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DownloadButton from './DownloadButton'

const mockGet = vi.fn()
vi.mock('../api', () => ({
  default: { get: (...a) => mockGet(...a) },
  mediaUrl: (p) => `http://localhost/api${p}`,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => {
      if (k === 'common.download') return 'Download'
      if (k === 'common.loading') return 'Loading'
      if (k === 'variants.downloadVersion') return 'Download version'
      if (k === 'variants.mainVersion') return 'Main version'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

describe('DownloadButton', () => {
  // Each test sets the behaviour it needs; this only drops call records.
  // Note it is deliberately not mockReset(): clearing the implementation while a
  // previous test's request is still in flight leaves that promise with no
  // handler, which surfaces as an unhandled rejection attributed to whichever
  // test happens to run next.
  beforeEach(() => mockGet.mockClear())

  it('is a plain download link when the item has one version', () => {
    render(<DownloadButton type="maps" id="m1" item={{ id: 'm1', variant_count: 0 }} />)
    const link = screen.getByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute('href', 'http://localhost/api/maps/m1/file')
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('stays a plain link when no item is supplied at all', () => {
    render(<DownloadButton type="maps" id="m1" />)
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()
  })

  it('opens a version picker when the item has other versions', async () => {
    mockGet.mockResolvedValue({
      id: 'm1',
      variant_main_id: 'm1',
      variants: [{ id: 'm2', kind: 'gridless', label: '' }],
    })
    render(<DownloadButton type="maps" id="m1" item={{ id: 'm1', variant_count: 1 }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Download version' }))

    const main = await screen.findByRole('menuitem', { name: 'Main version' })
    expect(main).toHaveAttribute('href', 'http://localhost/api/maps/m1/file')
    expect(screen.getByRole('menuitem', { name: 'gridless' })).toHaveAttribute(
      'href',
      'http://localhost/api/maps/m2/file'
    )
  })

  it('does not fetch the family until the picker is opened', () => {
    render(<DownloadButton type="maps" id="m1" item={{ id: 'm1', variant_count: 1 }} />)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('uses an inline variants array without a request', async () => {
    render(
      <DownloadButton
        type="books"
        id="b1"
        item={{ id: 'b1', variant_main_id: 'b1', variants: [{ id: 'b2', kind: 'spreads' }] }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download version' }))
    expect(await screen.findByRole('menuitem', { name: 'spreads' })).toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('prefers a free-text label over the kind', async () => {
    mockGet.mockResolvedValue({
      id: 'b1',
      variant_main_id: 'b1',
      variants: [{ id: 'b2', kind: 'version', label: 'v1.0.1' }],
    })
    render(<DownloadButton type="books" id="b1" item={{ id: 'b1', variant_count: 1 }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download version' }))
    expect(await screen.findByRole('menuitem', { name: 'v1.0.1' })).toBeInTheDocument()
  })

  it('closes the picker on Escape', async () => {
    mockGet.mockResolvedValue({
      id: 'b1',
      variant_main_id: 'b1',
      variants: [{ id: 'b2', kind: 'other' }],
    })
    render(<DownloadButton type="books" id="b1" item={{ id: 'b1', variant_count: 1 }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download version' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})

// Isolated: a rejecting implementation must stay installed while its request
// settles, so this case cannot share the mockClear above.
describe('DownloadButton when the family cannot be loaded', () => {
  it('still opens the picker', async () => {
    mockGet.mockImplementation(() => Promise.reject(new Error('nope')))
    render(<DownloadButton type="books" id="b9" item={{ id: 'b9', variant_count: 1 }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download version' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading')).not.toBeInTheDocument())
  })
})
