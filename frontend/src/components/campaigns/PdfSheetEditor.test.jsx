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
        clone: () => ({ width: 600, height: 800 }),
      }),
      render: () => ({ promise: Promise.resolve() }),
      getAnnotations: () => Promise.resolve([]),
    })
  ),
  saveDocument: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  destroy: vi.fn(),
}

const getDocument = vi.fn(() => ({ promise: Promise.resolve(fakeDoc) }))
const annotationRender = vi.fn(() => Promise.resolve())

vi.mock('../../lib/pdfjs', () => ({
  default: {
    getDocument: (...a) => getDocument(...a),
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
    // The interactive form layer is rendered for the page.
    await waitFor(() => expect(annotationRender).toHaveBeenCalled())
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
