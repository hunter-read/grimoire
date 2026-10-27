import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImagePickerModal from './ImagePickerModal'
import { imageSources } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

vi.mock('../../api', () => ({
  imageSources: {
    search: vi.fn(),
    thumbUrl: (type, id) => `/api/${type}s/${id}/thumbnail`,
  },
}))

const pngFile = (name = 'x.png') => new File(['x'], name, { type: 'image/png' })

const props = (over = {}) => ({
  title: 'Set image',
  onUpload: vi.fn().mockResolvedValue(undefined),
  onPickSource: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  imageSources.search.mockResolvedValue([
    { resource_type: 'map', resource_id: 'm1', name: 'ruins.png', has_thumbnail: true },
  ])
})

describe('ImagePickerModal', () => {
  it('starts on the upload tab with saving disabled', () => {
    render(<ImagePickerModal {...props()} />)
    expect(screen.getByText('imagePicker.chooseFile')).toBeInTheDocument()
    expect(screen.getByText('imagePicker.save').closest('button')).toBeDisabled()
  })

  it('uploads a staged file and closes', async () => {
    const p = props()
    render(<ImagePickerModal {...p} />)
    const file = pngFile()

    await userEvent.upload(screen.getByTestId('image-picker-input'), file)
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(p.onUpload).toHaveBeenCalledWith(file))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('accepts an image pasted from the clipboard', async () => {
    const p = props()
    render(<ImagePickerModal {...p} />)
    const file = pngFile('pasted.png')

    const event = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = {
      items: [{ kind: 'file', getAsFile: () => file }],
      files: [file],
    }
    fireEvent(document, event)

    // The staged filename is shown, and saving sends the pasted bytes.
    await waitFor(() => expect(screen.getByText('pasted.png')).toBeInTheDocument())
    await userEvent.click(screen.getByText('imagePicker.save'))
    await waitFor(() => expect(p.onUpload).toHaveBeenCalledWith(file))
  })

  it('accepts an image dropped onto the panel', async () => {
    const p = props()
    render(<ImagePickerModal {...p} />)
    const file = pngFile('dropped.png')

    fireEvent.drop(screen.getByTestId('image-picker-panel'), {
      dataTransfer: { items: [{ kind: 'file', getAsFile: () => file }], files: [file] },
    })

    await waitFor(() => expect(screen.getByText('dropped.png')).toBeInTheDocument())
  })

  it('sets the image from a browsed library asset', async () => {
    const p = props()
    render(<ImagePickerModal {...p} />)

    await userEvent.click(screen.getByText('imagePicker.mode.browse'))
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())
    await userEvent.click(screen.getByText('ruins.png'))
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() =>
      expect(p.onPickSource).toHaveBeenCalledWith({ source_type: 'map', source_id: 'm1' })
    )
    expect(p.onUpload).not.toHaveBeenCalled()
  })

  it('a staged upload wins over an earlier browse pick', async () => {
    const p = props()
    render(<ImagePickerModal {...p} />)

    await userEvent.click(screen.getByText('imagePicker.mode.browse'))
    await waitFor(() => expect(screen.getByText('ruins.png')).toBeInTheDocument())
    await userEvent.click(screen.getByText('ruins.png'))

    // Uploading afterwards replaces the pick rather than sending both. The file
    // input only exists on the upload tab, so switch back to it first.
    await userEvent.click(screen.getByText('imagePicker.mode.upload'))
    await userEvent.upload(screen.getByTestId('image-picker-input'), pngFile())
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(p.onUpload).toHaveBeenCalled())
    expect(p.onPickSource).not.toHaveBeenCalled()
  })

  it('shows the failure and stays open when saving fails', async () => {
    const p = props({ onUpload: vi.fn().mockRejectedValue(new Error('too big')) })
    render(<ImagePickerModal {...p} />)

    await userEvent.upload(screen.getByTestId('image-picker-input'), pngFile())
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too big'))
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('offers removal only when there is an image and a handler', () => {
    const { rerender } = render(<ImagePickerModal {...props({ hasImage: true })} />)
    // No onRemove: nothing to offer.
    expect(screen.queryByText('imagePicker.remove')).not.toBeInTheDocument()

    rerender(<ImagePickerModal {...props({ hasImage: true, onRemove: vi.fn() })} />)
    expect(screen.getByText('imagePicker.remove')).toBeInTheDocument()
  })

  it('removes the image and closes', async () => {
    const p = props({ hasImage: true, onRemove: vi.fn().mockResolvedValue(undefined) })
    render(<ImagePickerModal {...p} />)

    await userEvent.click(screen.getByText('imagePicker.remove'))

    await waitFor(() => expect(p.onRemove).toHaveBeenCalled())
    expect(p.onClose).toHaveBeenCalled()
  })

  it('renders a caller-supplied preview instead of the default one', () => {
    render(
      <ImagePickerModal
        {...props()}
        previewSrc="http://existing.png"
        renderPreview={({ src }) => <div data-testid="custom">{src}</div>}
      />
    )
    expect(screen.getByTestId('custom')).toHaveTextContent('http://existing.png')
    expect(document.querySelector('img')).toBeNull()
  })

  it('closes from the close button and the backdrop, but not the panel', async () => {
    const p = props()
    const { container } = render(<ImagePickerModal {...p} />)

    await userEvent.click(screen.getByLabelText('common.close'))
    expect(p.onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(container.firstChild)
    expect(p.onClose).toHaveBeenCalledTimes(2)

    await userEvent.click(screen.getByText('Set image'))
    expect(p.onClose).toHaveBeenCalledTimes(2)
  })
})
