import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BannerUploadModal from './BannerUploadModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

// The banner dialog is now a thin wrapper over the shared image picker
// (issue #286); the browse tab searches the library through this.
vi.mock('../../api', () => ({
  imageSources: {
    search: vi.fn(() =>
      Promise.resolve([
        { resource_type: 'map', resource_id: 'm1', name: 'ruins.png', has_thumbnail: true },
      ])
    ),
    thumbUrl: (type, id) => `/api/${type}s/${id}/thumbnail`,
  },
}))

const pngFile = () => new File(['x'], 'x.png', { type: 'image/png' })

const props = (over = {}) => ({
  hasBanner: false,
  onPick: vi.fn(),
  onPickSource: vi.fn(),
  onFocusChange: vi.fn(),
  onRemove: vi.fn(),
  onClose: vi.fn(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BannerUploadModal', () => {
  it('renders the guidance copy and no remove action without a banner', () => {
    render(<BannerUploadModal {...props()} />)
    expect(screen.getByText('campaignDetail.banner.modalTitle')).toBeInTheDocument()
    expect(screen.getByText('campaignDetail.banner.suggestedSize')).toBeInTheDocument()
    expect(screen.getByText('campaignDetail.banner.allowedFormats')).toBeInTheDocument()
    expect(screen.queryByText('imagePicker.remove')).not.toBeInTheDocument()
  })

  it('shows the preview image and the remove action when a banner exists', () => {
    render(<BannerUploadModal {...props({ hasBanner: true, previewSrc: 'http://banner.png' })} />)
    expect(document.querySelector('img')).toHaveAttribute('src', 'http://banner.png')
    expect(screen.getByText('imagePicker.remove')).toBeInTheDocument()
  })

  it('uploads the picked file and closes on success', async () => {
    const p = props({ onPick: vi.fn().mockResolvedValue(undefined) })
    render(<BannerUploadModal {...p} />)

    const file = pngFile()
    await userEvent.upload(screen.getByTestId('image-picker-input'), file)
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(p.onPick).toHaveBeenCalledWith(file))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('shows the error and stays open when the upload fails', async () => {
    const p = props({ onPick: vi.fn().mockRejectedValue(new Error('too big')) })
    render(<BannerUploadModal {...p} />)

    await userEvent.upload(screen.getByTestId('image-picker-input'), pngFile())
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too big'))
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('cannot be saved until something has been chosen', () => {
    render(<BannerUploadModal {...props()} />)
    expect(screen.getByText('imagePicker.save').closest('button')).toBeDisabled()
  })

  it('sets the banner from a library asset instead of uploading', async () => {
    const p = props({ onPickSource: vi.fn().mockResolvedValue(undefined) })
    render(<BannerUploadModal {...p} />)

    await userEvent.click(screen.getByText('imagePicker.mode.browse'))
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())
    await userEvent.click(screen.getByText('ruins.png'))
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() =>
      expect(p.onPickSource).toHaveBeenCalledWith({ source_type: 'map', source_id: 'm1' })
    )
    expect(p.onPick).not.toHaveBeenCalled()
  })

  it('removes the banner and closes', async () => {
    const p = props({ hasBanner: true, onRemove: vi.fn().mockResolvedValue(undefined) })
    render(<BannerUploadModal {...p} />)

    await userEvent.click(screen.getByText('imagePicker.remove'))

    await waitFor(() => expect(p.onRemove).toHaveBeenCalled())
    expect(p.onClose).toHaveBeenCalled()
  })

  it('writes the focal point alongside a newly uploaded banner', async () => {
    const p = props({ focusY: 50, onPick: vi.fn().mockResolvedValue(undefined) })
    render(<BannerUploadModal {...p} previewSrc="http://banner.png" />)

    // The reposition control only appears once the image reports an aspect
    // ratio taller than the 2:1 hero — otherwise there is nothing to slide.
    const img = document.querySelector('img')
    Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true })
    fireEvent.load(img)

    const slider = await screen.findByLabelText('campaignDetail.banner.verticalPosition')
    fireEvent.change(slider, { target: { value: '20' } })

    await userEvent.upload(screen.getByTestId('image-picker-input'), pngFile())
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(p.onFocusChange).toHaveBeenCalledWith(20))
  })

  it('saves a reposition on its own, without touching the image', async () => {
    const p = props({ hasBanner: true, focusY: 50, onFocusChange: vi.fn().mockResolvedValue() })
    render(<BannerUploadModal {...p} previewSrc="http://banner.png" />)

    const img = document.querySelector('img')
    Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true })
    fireEvent.load(img)

    fireEvent.change(await screen.findByLabelText('campaignDetail.banner.verticalPosition'), {
      target: { value: '30' },
    })
    // A dedicated save appears once the position has moved, so nudging an
    // existing banner never re-uploads it.
    await userEvent.click(screen.getByText('campaignDetail.banner.savePosition'))

    await waitFor(() => expect(p.onFocusChange).toHaveBeenCalledWith(30))
    expect(p.onPick).not.toHaveBeenCalled()
    expect(p.onPickSource).not.toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('offers no reposition save until the position actually moves', async () => {
    render(<BannerUploadModal {...props({ hasBanner: true, focusY: 50 })} previewSrc="/b.png" />)

    const img = document.querySelector('img')
    Object.defineProperty(img, 'naturalWidth', { value: 100, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true })
    fireEvent.load(img)

    await screen.findByLabelText('campaignDetail.banner.verticalPosition')
    expect(screen.queryByText('campaignDetail.banner.savePosition')).not.toBeInTheDocument()
  })

  it('leaves the focal point alone when it did not move', async () => {
    const p = props({ focusY: 50, onPick: vi.fn().mockResolvedValue(undefined) })
    render(<BannerUploadModal {...p} />)

    await userEvent.upload(screen.getByTestId('image-picker-input'), pngFile())
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(p.onPick).toHaveBeenCalled())
    expect(p.onFocusChange).not.toHaveBeenCalled()
  })

  it('closes via the close button and via a click on the backdrop', async () => {
    const p = props()
    const { container } = render(<BannerUploadModal {...p} />)

    await userEvent.click(screen.getByLabelText('common.close'))
    expect(p.onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(container.firstChild)
    expect(p.onClose).toHaveBeenCalledTimes(2)

    // Clicking inside the panel must not close the modal.
    await userEvent.click(screen.getByText('campaignDetail.banner.modalTitle'))
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })
})
