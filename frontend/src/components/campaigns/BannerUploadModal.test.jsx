import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BannerUploadModal from './BannerUploadModal'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const pngFile = () => new File(['x'], 'x.png', { type: 'image/png' })

const fileInput = (container) => container.querySelector('input[type="file"]')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BannerUploadModal', () => {
  it('renders the guidance copy and the upload label when there is no banner', () => {
    render(
      <BannerUploadModal hasBanner={false} onPick={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('campaignDetail.banner.modalTitle')).toBeInTheDocument()
    expect(screen.getByText('campaignDetail.banner.suggestedSize')).toBeInTheDocument()
    expect(screen.getByText('campaignDetail.banner.allowedFormats')).toBeInTheDocument()
    expect(screen.getByText('campaignDetail.banner.upload')).toBeInTheDocument()
    // No banner yet, so no remove action and no preview image.
    expect(screen.queryByText('campaignDetail.banner.remove')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows the preview image and the replace/remove actions when a banner exists', () => {
    render(
      <BannerUploadModal
        hasBanner
        previewSrc="http://banner.png"
        onPick={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(document.querySelector('img')).toHaveAttribute('src', 'http://banner.png')
    expect(screen.getByText('campaignDetail.banner.replace')).toBeInTheDocument()
    expect(screen.getByText('campaignDetail.banner.remove')).toBeInTheDocument()
  })

  it('uploads the picked file and closes on success', async () => {
    const onPick = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const { container } = render(
      <BannerUploadModal hasBanner={false} onPick={onPick} onRemove={vi.fn()} onClose={onClose} />
    )
    const file = pngFile()
    await userEvent.upload(fileInput(container), file)
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(file))
    expect(onClose).toHaveBeenCalled()
    // The input is reset so re-picking the same file still fires a change.
    expect(fileInput(container).value).toBe('')
  })

  it('alerts and stays open when the upload fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const onPick = vi.fn().mockRejectedValue(new Error('too big'))
    const onClose = vi.fn()
    const { container } = render(
      <BannerUploadModal hasBanner={false} onPick={onPick} onRemove={vi.fn()} onClose={onClose} />
    )
    await userEvent.upload(fileInput(container), pngFile())
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('too big'))
    expect(onClose).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('does nothing when the picker is dismissed without a file', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <BannerUploadModal hasBanner={false} onPick={onPick} onRemove={vi.fn()} onClose={onClose} />
    )
    await userEvent.upload(fileInput(container), [])
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens the native picker when the upload button is clicked', async () => {
    const { container } = render(
      <BannerUploadModal hasBanner={false} onPick={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />
    )
    const clickSpy = vi.spyOn(fileInput(container), 'click').mockImplementation(() => {})
    await userEvent.click(screen.getByText('campaignDetail.banner.upload'))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('removes the banner and closes', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<BannerUploadModal hasBanner onPick={vi.fn()} onRemove={onRemove} onClose={onClose} />)
    await userEvent.click(screen.getByText('campaignDetail.banner.remove'))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('disables the action buttons while the caller reports it is busy', () => {
    render(
      <BannerUploadModal hasBanner busy onPick={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('campaignDetail.banner.remove').closest('button')).toBeDisabled()
    expect(screen.getByText('campaignDetail.banner.replace').closest('button')).toBeDisabled()
  })

  it('closes via the close button and via a click on the backdrop', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <BannerUploadModal hasBanner={false} onPick={vi.fn()} onRemove={vi.fn()} onClose={onClose} />
    )
    await userEvent.click(screen.getByLabelText('common.close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(2)

    // Clicking inside the panel must not close the modal.
    await userEvent.click(screen.getByText('campaignDetail.banner.modalTitle'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
