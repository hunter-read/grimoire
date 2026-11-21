import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import PdfDocumentViewer from './PdfDocumentViewer'

// ── A stand-in for pdf.js ────────────────────────────────────────────────────
// The real viewer needs canvas and layout, neither of which jsdom has. These
// fakes keep its contract: events through the bus, a page setter that reports
// the page it lands on, and an editor-mode setter that announces the change.

type Listener = (data: never) => void

const pdf = vi.hoisted(() => {
  const EDITOR = { NONE: 0, FREETEXT: 3, HIGHLIGHT: 9, INK: 15 }

  class FakeEventBus {
    listeners = new Map<string, Set<Listener>>()
    on(name: string, fn: Listener, opts?: { signal?: AbortSignal }) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set())
      this.listeners.get(name)!.add(fn)
      opts?.signal?.addEventListener('abort', () => this.listeners.get(name)!.delete(fn))
    }
    dispatch(name: string, data: unknown) {
      for (const fn of this.listeners.get(name) ?? []) fn(data as never)
    }
  }

  class FakeViewer {
    opts: Record<string, unknown>
    eventBus: FakeEventBus
    currentScale = 1
    currentScaleValue: string | number = 'auto'
    page = 1
    pageSets: number[] = []
    setDocument = vi.fn()
    updateScale = vi.fn()
    increaseScale = vi.fn()
    decreaseScale = vi.fn()
    constructor(opts: Record<string, unknown>) {
      this.opts = opts
      this.eventBus = opts.eventBus as FakeEventBus
      state.viewers.push(this)
    }
    get currentPageNumber() {
      return this.page
    }
    set currentPageNumber(page: number) {
      this.page = page
      this.pageSets.push(page)
      this.eventBus.dispatch('pagechanging', { pageNumber: page })
    }
    set annotationEditorMode({ mode }: { mode: number }) {
      this.eventBus.dispatch('annotationeditormodechanged', { mode })
    }
    /** The reader scrolling the file by hand. */
    scrollTo(page: number) {
      this.page = page
      this.eventBus.dispatch('pagechanging', { pageNumber: page })
    }
  }

  const makeDoc = () => {
    const storage = {
      onSetModified: null as null | (() => void),
      onResetModified: null as null | (() => void),
      resetModified: vi.fn(() => storage.onResetModified?.()),
    }
    return {
      numPages: 12,
      annotationStorage: storage,
      saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    }
  }

  const state = {
    viewers: [] as FakeViewer[],
    touch: [] as Record<string, (...a: never[]) => void>[],
    tasks: [] as { url: string; destroy: ReturnType<typeof vi.fn> }[],
    doc: makeDoc(),
    fail: false,
  }

  return { EDITOR, FakeEventBus, FakeViewer, makeDoc, state }
})

vi.mock('../../lib/pdfjs', () => ({
  WASM_URL: '/pdfjs-wasm/',
  default: {
    AnnotationEditorType: pdf.EDITOR,
    getDocument: (params: { url: string }) => {
      const task = {
        url: params.url,
        destroy: vi.fn(() => Promise.resolve()),
        promise: pdf.state.fail
          ? Promise.reject(new Error('bad pdf'))
          : Promise.resolve(pdf.state.doc),
      }
      pdf.state.tasks.push(task)
      return task
    },
    TouchManager: class {
      constructor(opts: Record<string, (...a: never[]) => void>) {
        pdf.state.touch.push(opts)
      }
    },
  },
}))

vi.mock('../../lib/pdfjsViewer', () => ({
  EventBus: pdf.FakeEventBus,
  PDFViewer: pdf.FakeViewer,
  PDFLinkService: class {
    setViewer = vi.fn()
    setDocument = vi.fn()
  },
  LinkTarget: { BLANK: 2 },
  ScrollMode: {},
}))

const viewer = () => pdf.state.viewers[pdf.state.viewers.length - 1]

/** The viewer's pages, ready to read: the document handed over and laid out. */
async function ready() {
  await waitFor(() => expect(viewer().setDocument).toHaveBeenCalledWith(pdf.state.doc))
  act(() => viewer().eventBus.dispatch('pagesinit', {}))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Highlight' })).toBeEnabled())
}

interface HarnessProps {
  initialPage?: number
  onPageChange?: (page: number) => void
  onDirtyChange?: (dirty: boolean) => void
}

let jumpTo: (page: number) => void = () => {}

/** The reader around the viewer: it holds the page and hands it back down. */
function Harness({ initialPage = 1, onPageChange, onDirtyChange }: HarnessProps) {
  const [page, setPage] = useState(initialPage)
  jumpTo = setPage
  return (
    <PdfDocumentViewer
      url="/api/books/b1/file"
      title="Core Rules"
      filename="core-rules.pdf"
      page={page}
      onPageChange={(p) => {
        onPageChange?.(p)
        setPage(p)
      }}
      onDirtyChange={onDirtyChange}
    />
  )
}

beforeEach(() => {
  pdf.state.viewers = []
  pdf.state.touch = []
  pdf.state.tasks = []
  pdf.state.doc = pdf.makeDoc()
  pdf.state.fail = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PdfDocumentViewer — loading', () => {
  it('opens the file by range request and shows a spinner until the pages are laid out', async () => {
    render(<Harness />)
    expect(screen.getByRole('document', { name: 'Core Rules' })).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(pdf.state.tasks[0].url).toBe('/api/books/b1/file')
    // The tools wait for a document to act on.
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeDisabled()
    await ready()
    expect(screen.getByRole('document', { name: 'Core Rules' })).toHaveAttribute(
      'aria-busy',
      'false'
    )
    // Opens fitted to the screen's width, which is what a phone wants.
    expect(viewer().currentScaleValue).toBe('page-width')
  })

  it('opens on the page the reader was already on', async () => {
    render(<Harness initialPage={7} />)
    await ready()
    expect(viewer().currentPageNumber).toBe(7)
  })

  it('says so when the file cannot be opened', async () => {
    pdf.state.fail = true
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent("This PDF couldn't be opened.")
  })

  it('lets go of the document when it closes', async () => {
    const { unmount } = render(<Harness />)
    await ready()
    unmount()
    expect(pdf.state.tasks[0].destroy).toHaveBeenCalled()
  })
})

describe('PdfDocumentViewer — following the page', () => {
  it('reports the page scrolled to, without jumping back to it', async () => {
    const onPageChange = vi.fn()
    render(<Harness onPageChange={onPageChange} />)
    await ready()
    act(() => {
      viewer().scrollTo(4)
      viewer().scrollTo(5)
    })
    expect(onPageChange.mock.calls).toEqual([[4], [5]])
    // The reader handing 4 and 5 back is an echo, not a request to go there.
    expect(viewer().pageSets).toEqual([])
    expect(viewer().currentPageNumber).toBe(5)
  })

  it('goes to a page asked for from outside', async () => {
    render(<Harness />)
    await ready()
    act(() => viewer().scrollTo(3))
    act(() => jumpTo(40))
    expect(viewer().pageSets).toEqual([40])
    // Then follows the reader on from there as before.
    act(() => viewer().scrollTo(41))
    expect(viewer().pageSets).toEqual([40])
  })
})

describe('PdfDocumentViewer — jumping while hidden (issue #944)', () => {
  // On a phone the reader hides the viewer (`display: none`) while a panel such
  // as the contents fills the screen. jsdom has no layout, so the tests say
  // what is hidden and when the container is resized.
  let hidden = false
  let resized: (() => void)[] = []

  beforeEach(() => {
    hidden = false
    resized = []
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      value: () => !hidden,
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resized.push(cb)
        }
        observe() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    delete (HTMLElement.prototype as { checkVisibility?: unknown }).checkVisibility
    vi.unstubAllGlobals()
  })

  const showAgain = () => {
    hidden = false
    act(() => resized.forEach((cb) => cb()))
  }

  it('waits to jump until the viewer is shown again', async () => {
    render(<Harness />)
    await ready()
    hidden = true
    act(() => jumpTo(40))
    // A hidden container can't scroll: setting the page now would move
    // pdf.js's page number and leave the old page on screen.
    expect(viewer().pageSets).toEqual([])

    showAgain()

    expect(viewer().pageSets).toEqual([40])
  })

  it('goes to the last page asked for while hidden', async () => {
    render(<Harness />)
    await ready()
    hidden = true
    act(() => jumpTo(40))
    act(() => jumpTo(12))
    showAgain()
    expect(viewer().pageSets).toEqual([12])
  })

  it('keeps waiting while a resize leaves it hidden', async () => {
    render(<Harness />)
    await ready()
    hidden = true
    act(() => jumpTo(40))
    act(() => resized.forEach((cb) => cb()))
    expect(viewer().pageSets).toEqual([])
  })

  it('drops a waiting jump once one is made while visible', async () => {
    render(<Harness />)
    await ready()
    hidden = true
    act(() => jumpTo(40))
    hidden = false
    act(() => jumpTo(10))
    expect(viewer().pageSets).toEqual([10])
    showAgain()
    expect(viewer().pageSets).toEqual([10])
  })

  it('opens on the reader’s page once shown, if laid out while hidden', async () => {
    hidden = true
    render(<Harness initialPage={7} />)
    await ready()
    expect(viewer().pageSets).toEqual([])
    showAgain()
    expect(viewer().pageSets).toEqual([7])
  })

  it('jumps straight away while visible', async () => {
    render(<Harness />)
    await ready()
    act(() => jumpTo(30))
    expect(viewer().pageSets).toEqual([30])
  })
})

describe('PdfDocumentViewer — zoom', () => {
  it('zooms in, out and back to the width of the screen', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await ready()
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(viewer().increaseScale).toHaveBeenCalledWith({ steps: 2 })
    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(viewer().decreaseScale).toHaveBeenCalledWith({ steps: 2 })
    viewer().currentScaleValue = 1.5
    await user.click(screen.getByRole('button', { name: 'Fit to width' }))
    expect(viewer().currentScaleValue).toBe('page-width')
  })

  it('shows the zoom pdf.js reports', async () => {
    render(<Harness />)
    await ready()
    act(() => viewer().eventBus.dispatch('scalechanging', { scale: 1.75 }))
    expect(screen.getByText('175%')).toBeInTheDocument()
  })

  it('pinches about the point between the fingers, carrying what rounding drops', async () => {
    render(<Harness />)
    await ready()
    const touch = pdf.state.touch[0]
    const v = viewer()
    // Applies the factor the way pdf.js does, rounding to the hundredth.
    v.updateScale.mockImplementation(({ scaleFactor }: { scaleFactor: number }) => {
      v.currentScale = Math.round(v.currentScale * scaleFactor * 100) / 100
    })
    act(() => touch.onPinching([100, 200] as never, 100 as never, 101.5 as never))
    // 1.015 is cut to 1.01; the rest is kept for the next move.
    const [{ scaleFactor, origin }] = v.updateScale.mock.calls[0]
    expect(scaleFactor).toBeCloseTo(1.01)
    expect(origin).toEqual([100, 200])
    expect(v.currentScale).toBe(1.01)
    act(() => touch.onPinching([100, 200] as never, 100 as never, 100.6 as never))
    // On its own 1.006 would round away to nothing; with what was carried
    // it takes the page on to 102%.
    expect(v.currentScale).toBe(1.02)
    act(() => touch.onPinchEnd())
  })

  it('scrolls on a two-finger drag that is not a pinch', async () => {
    render(<Harness />)
    await ready()
    const container = screen.getByRole('document', { name: 'Core Rules' })
    const scrollBy = vi.fn()
    container.scrollBy = scrollBy as never
    act(() => pdf.state.touch[0].onPanning(10 as never, -20 as never))
    expect(scrollBy).toHaveBeenCalledWith(-10, 20)
  })

  it('zooms on a trackpad pinch, and leaves a plain wheel to scroll', async () => {
    render(<Harness />)
    await ready()
    const container = screen.getByRole('document', { name: 'Core Rules' })
    container.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, cancelable: true }))
    expect(viewer().updateScale).not.toHaveBeenCalled()
    const pinch = new WheelEvent('wheel', { deltaY: -50, ctrlKey: true, cancelable: true })
    container.dispatchEvent(pinch)
    expect(pinch.defaultPrevented).toBe(true)
    expect(viewer().updateScale.mock.calls[0][0].scaleFactor).toBeCloseTo(Math.exp(0.5))
  })
})

describe('PdfDocumentViewer — annotating', () => {
  it('switches tools, showing the one in use', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await ready()
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('button', { name: 'Draw' }))
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Add text' }))
    expect(screen.getByRole('button', { name: 'Add text' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers to save a copy once there are annotations, and warns before they are lost', async () => {
    const onDirtyChange = vi.fn()
    render(<Harness onDirtyChange={onDirtyChange} />)
    await ready()
    expect(screen.queryByRole('button', { name: /Save a copy/ })).not.toBeInTheDocument()

    act(() => pdf.state.doc.annotationStorage.onSetModified!())
    expect(screen.getByRole('button', { name: /Save a copy/ })).toBeInTheDocument()
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
  })

  it('downloads the annotated file, then has nothing left to lose', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:annotated')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<Harness onDirtyChange={onDirtyChange} />)
    await ready()
    act(() => pdf.state.doc.annotationStorage.onSetModified!())

    await user.click(screen.getByRole('button', { name: /Save a copy/ }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Save a copy/ })).not.toBeInTheDocument()
    )
    expect(pdf.state.doc.saveDocument).toHaveBeenCalled()
    const downloaded = click.mock.contexts[0] as HTMLAnchorElement
    expect(downloaded.download).toBe('core-rules.pdf')
    expect(downloaded.href).toBe('blob:annotated')
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(false)
  })

  it('says so when a copy cannot be saved, and keeps the annotations', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await ready()
    pdf.state.doc.saveDocument.mockRejectedValueOnce(new Error('worker gone'))
    act(() => pdf.state.doc.annotationStorage.onSetModified!())
    await user.click(screen.getByRole('button', { name: /Save a copy/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save a copy.")
    expect(screen.getByRole('button', { name: /Save a copy/ })).toBeEnabled()
  })
})
