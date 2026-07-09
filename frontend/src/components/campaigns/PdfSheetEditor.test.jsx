import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PdfSheetEditor from './PdfSheetEditor'

// pdf.js can't run in jsdom, so mock the wrapper with a controllable fake doc.
const fakeDoc = {
  numPages: 1,
  annotationStorage: {},
  getPage: vi.fn(() =>
    Promise.resolve({
      getViewport: ({ scale = 1 }) => ({
        width: 600 * scale,
        height: 800 * scale,
        rawDims: { pageWidth: 600, pageHeight: 800 },
        clone: () => ({ width: 600, height: 800 }),
      }),
      render: (...a) => pageRender(...a),
      getAnnotations: () => Promise.resolve([]),
    })
  ),
  saveDocument: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  destroy: vi.fn(),
}

const getDocument = vi.fn(() => ({ promise: Promise.resolve(fakeDoc) }))
const pageRender = vi.fn(() => ({ promise: Promise.resolve() }))
const annotationRender = vi.fn(() => Promise.resolve())

vi.mock('../../lib/pdfjs', () => ({
  WASM_URL: '/pdfjs-wasm/',
  default: {
    getDocument: (...a) => getDocument(...a),
    AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
    AnnotationLayer: class {
      render(...a) {
        return annotationRender(...a)
      }
    },
  },
}))

vi.mock('pdfjs-dist/web/pdf_viewer.css', () => ({}))

const uploadMemberSheet = vi.fn(() => Promise.resolve({}))
vi.mock('../../api', () => ({
  campaigns: {
    memberSheetUrl: (id, mid) => `/api/campaigns/${id}/members/${mid}/sheet`,
    uploadMemberSheet: (...a) => uploadMemberSheet(...a),
  },
}))

// jsdom canvas has no 2d context by default.
beforeEach(() => {
  vi.clearAllMocks()
  pageRender.mockReturnValue({ promise: Promise.resolve() })
  annotationRender.mockResolvedValue(undefined)
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}))
})

const renderEditor = (props = {}) =>
  render(
    <PdfSheetEditor
      campaignId="c1"
      memberId="m1"
      onClose={props.onClose || vi.fn()}
      onSaved={props.onSaved || vi.fn()}
    />
  )

describe('PdfSheetEditor', () => {
  it('loads and renders the member sheet PDF', async () => {
    renderEditor()
    await waitFor(() =>
      expect(getDocument).toHaveBeenCalledWith(
        expect.objectContaining({ url: '/api/campaigns/c1/members/m1/sheet' })
      )
    )
    // wasmUrl must be passed or JPEG2000/JBIG2 page images fail to decode and
    // the page renders blank.
    expect(getDocument.mock.calls[0][0]).toMatchObject({ wasmUrl: '/pdfjs-wasm/' })
    // The interactive form layer is rendered for the page, with forms wired to
    // storage so edits can be saved.
    await waitFor(() => expect(annotationRender).toHaveBeenCalled())
    expect(annotationRender.mock.calls[0][0]).toMatchObject({ renderForms: true })
    // The canvas must NOT paint the form widgets (DISABLE) or every value would
    // show twice — once baked in, once as the live input.
    expect(pageRender).toHaveBeenCalledWith(expect.objectContaining({ annotationMode: 0 }))
  })

  it('sets up the pdfViewer scaling structure so form fields position correctly', async () => {
    const { container } = renderEditor()
    // Without the .pdfViewer wrapper + --scale-factor, pdf.js's stylesheet leaves
    // --total-scale-factor undefined and every AcroForm widget collapses into a
    // tiny box in the top-left corner. Assert the DOM pdf.js's CSS expects.
    const page = await waitFor(() => {
      const el = container.querySelector('.pdfViewer .page')
      expect(el).toBeTruthy()
      return el
    })
    // scale = RENDER_WIDTH (820) / base width (600).
    expect(page.style.getPropertyValue('--scale-factor')).toBe(String(820 / 600))
    expect(page.style.width).toBe('820px')
    // The canvas lives in a .canvasWrapper so the viewer canvas CSS applies.
    expect(page.querySelector('.canvasWrapper canvas')).toBeTruthy()
  })

  it('derives --scale-factor from the rendered width, not the nominal scale', async () => {
    // With a PDF UserUnit, viewport.width = rawWidth × scale × userUnit, so the
    // nominal `scale` passed to getViewport (RENDER_WIDTH / baseWidth) no longer
    // equals the layer factor pdf.js needs (renderedWidth / rawWidth). Using the
    // nominal scale makes widgets drift further from place the lower/righter they
    // sit. Model userUnit=1.5: base width becomes 900, so nominal scale = 820/900,
    // but the correct layer factor is 820/600.
    const userUnit = 1.5
    fakeDoc.getPage.mockResolvedValueOnce({
      getViewport: ({ scale = 1 }) => ({
        width: 600 * userUnit * scale,
        height: 800 * userUnit * scale,
        rawDims: { pageWidth: 600, pageHeight: 800 },
        clone: () => ({ width: 600, height: 800 }),
      }),
      render: () => ({ promise: Promise.resolve() }),
      getAnnotations: () => Promise.resolve([]),
    })
    const { container } = renderEditor()
    const page = await waitFor(() => {
      const el = container.querySelector('.pdfViewer .page')
      expect(el).toBeTruthy()
      return el
    })
    // renderedWidth (820) / rawDims.pageWidth (600), NOT the nominal scale 820/900.
    expect(page.style.getPropertyValue('--scale-factor')).toBe(String(820 / 600))
    expect(page.style.getPropertyValue('--scale-factor')).not.toBe(String(820 / 900))
  })

  it('saves a filled copy by uploading the PDF bytes', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    renderEditor({ onSaved, onClose })
    const saveBtn = await screen.findByRole('button', { name: /save copy/i })
    await waitFor(() => expect(saveBtn).not.toBeDisabled())

    await userEvent.click(saveBtn)

    await waitFor(() => expect(fakeDoc.saveDocument).toHaveBeenCalled())
    await waitFor(() => expect(uploadMemberSheet).toHaveBeenCalled())
    const [cid, mid, file] = uploadMemberSheet.mock.calls[0]
    expect(cid).toBe('c1')
    expect(mid).toBe('m1')
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('application/pdf')
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('commits the focused field before saving so its value is not lost', async () => {
    // A field mid-edit only writes to annotationStorage on blur, so save() must
    // blur the active element first. Spy on blur across elements to catch it
    // regardless of which element is focused when save runs.
    const blurSpy = vi.spyOn(HTMLElement.prototype, 'blur')
    renderEditor()
    const saveBtn = await screen.findByRole('button', { name: /save copy/i })
    await waitFor(() => expect(saveBtn).not.toBeDisabled())

    await userEvent.click(saveBtn)

    await waitFor(() => expect(fakeDoc.saveDocument).toHaveBeenCalled())
    expect(blurSpy).toHaveBeenCalled()
    blurSpy.mockRestore()
  })

  it('does not render pages after being unmounted mid-load', async () => {
    // Simulate a doc that resolves after the component has already unmounted
    // (React StrictMode double-invoke), so the superseded run must bail out.
    let resolveDoc
    getDocument.mockReturnValueOnce({ promise: new Promise((r) => (resolveDoc = r)) })
    const { container, unmount } = renderEditor()
    unmount()
    resolveDoc(fakeDoc)
    await Promise.resolve()
    await Promise.resolve()
    // The superseded run destroyed the doc and never drew a page.
    expect(fakeDoc.destroy).toHaveBeenCalled()
    expect(container.querySelector('.page')).toBeNull()
  })

  it('shows an error when the PDF fails to load', async () => {
    getDocument.mockReturnValueOnce({ promise: Promise.reject(new Error('bad pdf')) })
    renderEditor()
    await waitFor(() =>
      expect(screen.getByText(/could not open or save this sheet/i)).toBeInTheDocument()
    )
  })

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderEditor({ onClose })
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
