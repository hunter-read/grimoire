import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import api, { files as filesApi } from '../../../api'
import { useAuth } from '../../../context/AuthContext'
import { useUISettings } from '../../../context/UISettingsContext'
import ExportSidebar from './ExportSidebar'
import usePageExport from './usePageExport'
import type { ExportBody } from './usePageExport'

// The transport is typed per route; these tests answer it loosely.
type Loose = Mock<(url: string, ...rest: unknown[]) => Promise<unknown>>
const mockGet = () => api.get as unknown as Loose
const mockPost = () => api.post as unknown as Loose
const mockDownload = () => vi.mocked(api.download)
const mockBrowse = () => filesApi.browse as unknown as Mock<(path: string) => Promise<unknown>>
const mockAuth = (value: unknown) =>
  vi.mocked(useAuth).mockReturnValue(value as ReturnType<typeof useAuth>)
const mockUISettings = (value: unknown) =>
  vi.mocked(useUISettings).mockReturnValue(value as ReturnType<typeof useUISettings>)

vi.mock('../../../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), download: vi.fn() },
  files: { browse: vi.fn() },
}))
vi.mock('../../../context/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../context/UISettingsContext', () => ({ useUISettings: vi.fn() }))
vi.mock('../../../hooks/useIsMobile', () => ({ default: () => false }))

const TOC = {
  toc: [
    { title: 'Intro', page: 1, children: [] },
    { title: 'Tokens', page: 4, children: [] },
    { title: 'Appendix', page: 7, children: [] },
  ],
}
const SHAPES = {
  shapes: [
    { shape: 'ellipse', x: 0.1, y: 0.1, w: 0.2, h: 0.15 },
    { shape: 'rect', x: 0.5, y: 0.1, w: 0.2, h: 0.155 },
  ],
}

function Harness({ visible = [4], total = 8, onShowPage = vi.fn() }) {
  const exporter = usePageExport({
    basePath: '/books/b1',
    title: 'Ashen Realms',
    visiblePages: visible,
  })
  return (
    <ExportSidebar
      exporter={exporter}
      title="Ashen Realms"
      totalPages={total}
      currentPage={visible[0]}
      isSpread={visible.length > 1}
      spreadOffset={0}
      tocPath="/books/b1/toc"
      pageUrl={(p: number, w?: number) => `/p/${p}?w=${w}`}
      sourcePath="books/Ashen/core/Ashen.pdf"
      onShowPage={onShowPage}
      onClose={vi.fn()}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth({ user: { role: 'admin' } })
  mockUISettings({ library_writable: true })
  mockGet().mockImplementation((url: string) => {
    if (url.endsWith('/size')) return Promise.resolve({ width: 612, height: 792 })
    if (url.endsWith('/toc')) return Promise.resolve(TOC)
    if (url.endsWith('/shapes')) return Promise.resolve(SHAPES)
    return Promise.reject(new Error(`unexpected ${url}`))
  })
  mockDownload().mockResolvedValue(undefined)
  mockBrowse().mockImplementation((path: string) =>
    Promise.resolve(
      path === ''
        ? {
            writable: true,
            entries: [
              { name: 'books', path: 'books', is_dir: true },
              { name: 'maps', path: 'maps', is_dir: true },
              { name: 'tokens', path: 'tokens', is_dir: true },
            ],
          }
        : { writable: true, entries: [] }
    )
  )
})

const pagesInput = () => screen.getByLabelText('Pages')
const downloadButton = () => screen.getByRole('button', { name: /^Download$/ })

describe('ExportSidebar - whole pages', () => {
  it('starts on the page on screen and downloads it as a PDF', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(pagesInput()).toHaveValue('4')
    expect(screen.getByText('1 page → 1 PDF')).toBeInTheDocument()

    await user.click(downloadButton())
    expect(api.download).toHaveBeenCalledWith('/books/b1/export', 'Ashen Realms.zip', {
      method: 'POST',
      body: expect.objectContaining({
        kind: 'pages',
        pages: '4',
        format: 'pdf',
        join_spreads: false,
      }),
    })
    expect(await screen.findByText('Downloaded')).toBeInTheDocument()
  })

  it('offers the spread, the table-of-contents section and the whole book', async () => {
    const user = userEvent.setup()
    render(<Harness visible={[4, 5]} />)
    expect(pagesInput()).toHaveValue('4-5')

    await user.click(await screen.findByRole('button', { name: 'Section: Tokens' }))
    expect(pagesInput()).toHaveValue('4-6')
    await user.click(screen.getByRole('button', { name: 'All 8' }))
    expect(pagesInput()).toHaveValue('1-8')
    await user.click(screen.getByRole('button', { name: 'This spread' }))
    expect(pagesInput()).toHaveValue('4-5')
    await user.click(screen.getByRole('button', { name: 'This page' }))
    expect(pagesInput()).toHaveValue('4')
  })

  it('explains a bad page list and blocks the download', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.clear(pagesInput())
    await user.type(pagesInput(), '3, 40')
    expect(screen.getByText('Page 40 is past the end - this has 8 pages')).toBeInTheDocument()
    expect(pagesInput()).toHaveAttribute('aria-invalid', 'true')
    expect(downloadButton()).toBeDisabled()
  })

  it('shows resolution, pixel size and spread joining for images', async () => {
    const user = userEvent.setup()
    render(<Harness visible={[4, 5]} />)
    await user.click(screen.getByRole('radio', { name: 'PNG' }))
    expect(screen.getByRole('radiogroup', { name: 'Resolution' })).toBeInTheDocument()
    // 612 x 792 pt at 150 dpi, twice as wide when facing pages are joined.
    expect(await screen.findByText('2550 × 1650 px per spread')).toBeInTheDocument()
    expect(screen.getByText('1 PNG image')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Join facing pages/ }))
    expect(screen.getByText('1275 × 1650 px per page')).toBeInTheDocument()
    expect(screen.getByText('2 PNG images, zipped')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Print/ }))
    expect(screen.getByText('2550 × 3300 px per page')).toBeInTheDocument()
  })

  it('moves through the format choices with the arrow keys', async () => {
    render(<Harness />)
    const pdf = screen.getByRole('radio', { name: 'PDF' })
    fireEvent.keyDown(pdf, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'PNG' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'PNG' }), { key: 'ArrowLeft' })
    expect(pdf).toHaveAttribute('aria-checked', 'true')
  })

  it('reports a failed download', async () => {
    const user = userEvent.setup()
    mockDownload().mockRejectedValueOnce(new Error('Disk on fire'))
    render(<Harness />)
    await user.click(downloadButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk on fire')
  })
})

describe('ExportSidebar - cut-outs', () => {
  it('starts empty, then lists what Find shapes picks out', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Cut out' }))
    expect(screen.getByText('No cut-outs yet')).toBeInTheDocument()
    expect(downloadButton()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Find shapes on this page/ }))
    expect(await screen.findByText("Found 2 - remove any you don't need.")).toBeInTheDocument()
    expect(screen.getByText('Cut-outs (2)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ashen Realms (p4) 1')).toBeInTheDocument()
    expect(screen.getByText('2 PNG files, zipped')).toBeInTheDocument()
    expect(await screen.findByText(/Circle · \d+ × \d+ px/)).toBeInTheDocument()

    // A second look finds nothing new.
    await user.click(screen.getByRole('button', { name: /Find shapes/ }))
    expect(await screen.findByText('Everything found here is already cut out.')).toBeInTheDocument()
  })

  it('refuses PDF while a round cut-out is in the list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Cut out' }))
    await user.click(screen.getByRole('button', { name: /Find shapes/ }))
    await screen.findByText('Cut-outs (2)')
    expect(screen.getByRole('radio', { name: 'PDF' })).toBeDisabled()
  })

  it('renames, removes and clears cut-outs, and sends names with the export', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Cut out' }))
    await user.click(screen.getByRole('button', { name: /Find shapes/ }))
    await screen.findByText('Cut-outs (2)')

    await user.type(screen.getByLabelText('File name for cut-out 1'), 'Goblin')
    await user.click(downloadButton())
    const body = mockDownload().mock.calls[0][2]!.body as ExportBody
    expect(body.kind).toBe('regions')
    expect(body.regions!.map((r) => r.name)).toEqual(['Goblin', ''])
    expect(body.regions![0]).toMatchObject({ pages: [4], shape: 'ellipse' })

    await user.click(screen.getByRole('button', { name: 'Remove cut-out 2' }))
    expect(screen.getByText('Cut-outs (1)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText('No cut-outs yet')).toBeInTheDocument()
  })

  it('says so when a page has nothing to find, or the lookup fails', async () => {
    const user = userEvent.setup()
    mockGet().mockImplementation((url: string) =>
      url.endsWith('/shapes')
        ? Promise.resolve({ shapes: [] })
        : Promise.resolve({ width: 612, height: 792, toc: [] })
    )
    render(<Harness />)
    await user.click(screen.getByRole('radio', { name: 'Cut out' }))
    await user.click(screen.getByRole('button', { name: /Find shapes/ }))
    expect(await screen.findByText(/Nothing found/)).toBeInTheDocument()

    mockGet().mockRejectedValueOnce(new Error('boom'))
    await user.click(screen.getByRole('button', { name: /Find shapes/ }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('jumps to a page from its group heading', async () => {
    const user = userEvent.setup()
    const onShowPage = vi.fn()
    render(<Harness onShowPage={onShowPage} />)
    await user.click(screen.getByRole('radio', { name: 'Cut out' }))
    await user.click(screen.getByRole('button', { name: /Find shapes/ }))
    await user.click(await screen.findByRole('button', { name: 'Page 4' }))
    expect(onShowPage).toHaveBeenCalledWith(4)
  })
})

describe('ExportSidebar - save to library', () => {
  it('is only offered to admins on a writable library', () => {
    mockAuth({ user: { role: 'gm' } })
    const { unmount } = render(<Harness />)
    expect(screen.queryByRole('button', { name: /Save to library/ })).not.toBeInTheDocument()
    unmount()

    mockAuth({ user: { role: 'admin' } })
    mockUISettings({ library_writable: false })
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /Save to library/ })).not.toBeInTheDocument()
  })

  it('opens beside the original, warns about PDFs in Tokens, and saves', async () => {
    const user = userEvent.setup()
    mockPost().mockImplementation((url: string) =>
      url === '/rescan'
        ? Promise.resolve({ status: 'scan_started' })
        : Promise.resolve({
            folder: 'books/Ashen/core',
            saved: [
              {
                path: 'books/Ashen/core/Ashen Realms (p4).pdf',
                name: 'Ashen Realms (p4).pdf',
                size: 9,
              },
            ],
          })
    )
    const started = vi.fn()
    window.addEventListener('grimoire:scan-started', started)
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Save to library/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Save to library' })
    expect(within(dialog).getByText('Saving into books/Ashen/core')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Beside the original' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(await within(dialog).findByRole('button', { name: 'Tokens' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Tokens only take images')
    expect(within(dialog).getByRole('button', { name: 'Save here' })).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Beside the original' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save here' }))

    expect(api.post).toHaveBeenCalledWith(
      '/books/b1/export/save',
      expect.objectContaining({ kind: 'pages', destination: 'books/Ashen/core' })
    )
    expect(api.post).toHaveBeenCalledWith('/rescan', {
      scope: 'books/Ashen/core',
      metadata_mode: 'new',
    })
    expect(await screen.findByText('1 file saved to books/Ashen/core.')).toBeInTheDocument()
    expect(screen.getByText(/Indexing it now/)).toBeInTheDocument()
    expect(started).toHaveBeenCalled()
    window.removeEventListener('grimoire:scan-started', started)

    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says when the files will be indexed later, and shows a failed save', async () => {
    const user = userEvent.setup()
    mockPost().mockImplementation((url: string) =>
      url === '/rescan'
        ? Promise.resolve({ status: 'already_running' })
        : Promise.resolve({
            folder: 'books/Ashen/core',
            saved: [{ path: 'a', name: 'a.pdf', size: 1 }],
          })
    )
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Save to library/ }))
    await user.click(await screen.findByRole('button', { name: 'Save here' }))
    expect(await screen.findByText(/already running/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    mockPost().mockRejectedValueOnce(new Error('Read-only library'))
    await user.click(screen.getByRole('button', { name: /Save to library/ }))
    await user.click(await screen.findByRole('button', { name: 'Save here' }))
    expect(await screen.findByText('Read-only library')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
