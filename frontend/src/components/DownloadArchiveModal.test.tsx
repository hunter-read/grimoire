import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DownloadArchiveModal from './DownloadArchiveModal'

// Stub mediaUrl so tests don't need a real token in localStorage
vi.mock('../api', () => ({
  mediaUrl: (path, params) => {
    const qs = new URLSearchParams(params).toString()
    return `/api${path}?${qs}`
  },
}))

const defaultProps = {
  title: 'All books in D&D 5e',
  params: { type: 'system', id: 'sys-1' },
  onClose: vi.fn(),
}

function renderModal(props = {}) {
  return render(<DownloadArchiveModal {...defaultProps} {...props} />)
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('DownloadArchiveModal — rendering', () => {
  it('renders the "Download Archive" heading', () => {
    renderModal()
    expect(screen.getByText('Download Archive')).toBeInTheDocument()
  })

  it('renders the title prop as a subtitle', () => {
    renderModal()
    expect(screen.getByText('All books in D&D 5e')).toBeInTheDocument()
  })

  it('renders all four format options', () => {
    renderModal()
    expect(screen.getByText('ZIP')).toBeInTheDocument()
    expect(screen.getByText('TAR')).toBeInTheDocument()
    expect(screen.getByText('TAR.GZ')).toBeInTheDocument()
    expect(screen.getByText('TAR.BZ2')).toBeInTheDocument()
  })

  it('renders file extensions for each format', () => {
    renderModal()
    expect(screen.getByText('.zip')).toBeInTheDocument()
    expect(screen.getByText('.tar')).toBeInTheDocument()
    expect(screen.getByText('.tar.gz')).toBeInTheDocument()
    expect(screen.getByText('.tar.bz2')).toBeInTheDocument()
  })

  it('renders a Download button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
  })

  it('renders a Cancel button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('renders a close (X) button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('renders four radio inputs', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Default selection
// ---------------------------------------------------------------------------

describe('DownloadArchiveModal — default format', () => {
  it('selects ZIP by default', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    const zipRadio = radios.find((r) => r.value === 'zip')
    expect(zipRadio).toBeChecked()
  })

  it('does not check other formats by default', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    for (const radio of radios) {
      if (radio.value !== 'zip') {
        expect(radio).not.toBeChecked()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Format selection
// ---------------------------------------------------------------------------

describe('DownloadArchiveModal — format selection', () => {
  it('selecting tar.gz checks that radio', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    const tarGzRadio = radios.find((r) => r.value === 'tar.gz')
    fireEvent.click(tarGzRadio)
    expect(tarGzRadio).toBeChecked()
  })

  it('selecting a format unchecks zip', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    const tarBz2Radio = radios.find((r) => r.value === 'tar.bz2')
    const zipRadio = radios.find((r) => r.value === 'zip')
    fireEvent.click(tarBz2Radio)
    expect(zipRadio).not.toBeChecked()
    expect(tarBz2Radio).toBeChecked()
  })

  it('selecting tar checks tar radio', () => {
    renderModal()
    const radios = screen.getAllByRole('radio')
    const tarRadio = radios.find((r) => r.value === 'tar')
    fireEvent.click(tarRadio)
    expect(tarRadio).toBeChecked()
  })
})

// ---------------------------------------------------------------------------
// Close behaviour
// ---------------------------------------------------------------------------

describe('DownloadArchiveModal — close behaviour', () => {
  beforeEach(() => {
    defaultProps.onClose.mockReset()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when clicking the backdrop', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    // The backdrop is the outermost dialog div
    const backdrop = screen.getByRole('dialog')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not call onClose when clicking inside the card', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByText('Download Archive'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Download behaviour
// ---------------------------------------------------------------------------

describe('DownloadArchiveModal — download behaviour', () => {
  // Capture anchors appended to body without breaking document.createElement
  let appendedAnchors
  let origAppendChild
  let origRemoveChild

  beforeEach(() => {
    appendedAnchors = []
    origAppendChild = document.body.appendChild.bind(document.body)
    origRemoveChild = document.body.removeChild.bind(document.body)

    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el && el.tagName === 'A') {
        appendedAnchors.push(el)
        // Intercept click so the browser doesn't actually navigate
        el.click = vi.fn()
        return el
      }
      return origAppendChild(el)
    })
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => {
      if (el && el.tagName === 'A') return el
      return origRemoveChild(el)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clicking Download creates an anchor with the correct href', () => {
    const onClose = vi.fn()
    renderModal({ onClose, params: { type: 'system', id: 'sys-1' } })
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(appendedAnchors).toHaveLength(1)
    const href = appendedAnchors[0].href
    expect(href).toContain('/api/downloads/archive')
    expect(href).toContain('type=system')
    expect(href).toContain('id=sys-1')
    expect(href).toContain('fmt=zip')
  })

  it('clicking Download with tar.gz selected includes fmt=tar.gz in href', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios.find((r) => r.value === 'tar.gz'))
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(appendedAnchors).toHaveLength(1)
    expect(appendedAnchors[0].href).toContain('fmt=tar.gz')
  })

  it('clicking Download appends and clicks the anchor', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(appendedAnchors).toHaveLength(1)
    expect(appendedAnchors[0].click).toHaveBeenCalled()
  })

  it('clicking Download calls onClose after triggering download', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe('DownloadArchiveModal — accessibility', () => {
  it('dialog has role="dialog"', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('dialog has aria-modal="true"', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('dialog is labelled by the heading', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    const label = document.getElementById(labelId)
    expect(label).toBeInTheDocument()
    expect(label.textContent).toMatch(/Download Archive/i)
  })
})
