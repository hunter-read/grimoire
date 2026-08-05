import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CoverUpload from './CoverUpload'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../api', () => ({
  default: { upload: vi.fn(), delete: vi.fn() },
  mediaUrl: (path) => `/api${path}`,
}))

const makeSystem = (over = {}) => ({
  id: 'sys-1',
  name: 'Dungeons & Dragons',
  container_kind: 'parent',
  cover_image: '',
  has_cover: false,
  ...over,
})

const pngFile = () =>
  new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', {
    type: 'image/png',
  })

describe('CoverUpload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers a choose-image button when there is no cover', () => {
    render(<CoverUpload system={makeSystem()} />)
    expect(screen.getByText('systemEditor.chooseImage')).toBeInTheDocument()
  })

  it('shows no preview image when the system has no cover', () => {
    render(<CoverUpload system={makeSystem()} />)
    expect(screen.queryByTestId('cover-preview')).not.toBeInTheDocument()
  })

  it('previews the existing cover', () => {
    render(<CoverUpload system={makeSystem({ has_cover: true, cover_image: 'sys-1.png' })} />)
    expect(screen.getByTestId('cover-preview')).toHaveAttribute(
      'src',
      expect.stringContaining('/cover')
    )
  })

  it('uploads the chosen file and reports the change', async () => {
    api.upload.mockResolvedValue({ cover_image: 'sys-1.png' })
    const onChange = vi.fn()
    render(<CoverUpload system={makeSystem()} onChange={onChange} />)

    await userEvent.upload(screen.getByTestId('cover-upload-input'), pngFile())

    await waitFor(() => expect(api.upload).toHaveBeenCalled())
    expect(api.upload.mock.calls[0][0]).toBe('/systems/sys-1/cover')
    expect(onChange).toHaveBeenCalledWith({ cover_image: 'sys-1.png', has_cover: true })
  })

  it('surfaces an upload failure', async () => {
    api.upload.mockRejectedValue(new Error('too big'))
    render(<CoverUpload system={makeSystem()} onChange={vi.fn()} />)

    await userEvent.upload(screen.getByTestId('cover-upload-input'), pngFile())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too big'))
  })

  it('offers removal only once something has been uploaded', () => {
    const { rerender } = render(<CoverUpload system={makeSystem()} />)
    expect(screen.queryByText('systemEditor.removeCover')).not.toBeInTheDocument()

    rerender(<CoverUpload system={makeSystem({ cover_image: 'sys-1.png', has_cover: true })} />)
    expect(screen.getByText('systemEditor.removeCover')).toBeInTheDocument()
  })

  it('deletes the uploaded cover', async () => {
    api.delete.mockResolvedValue({ status: 'ok' })
    const onChange = vi.fn()
    render(
      <CoverUpload
        system={makeSystem({ cover_image: 'sys-1.png', has_cover: true })}
        onChange={onChange}
      />
    )
    await userEvent.click(screen.getByText('systemEditor.removeCover'))

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/systems/sys-1/cover'))
    expect(onChange).toHaveBeenCalledWith({ cover_image: '', has_cover: false })
  })

  it('explains when library folder art is taking precedence', () => {
    // has_cover with no upload means the art came from the library folder.
    render(<CoverUpload system={makeSystem({ has_cover: true, cover_image: '' })} />)
    expect(screen.getByText('systemEditor.folderCoverInUse')).toBeInTheDocument()
  })

  it('does not claim folder art when the cover is an upload', () => {
    render(<CoverUpload system={makeSystem({ has_cover: true, cover_image: 'sys-1.png' })} />)
    expect(screen.queryByText('systemEditor.folderCoverInUse')).not.toBeInTheDocument()
  })
})
