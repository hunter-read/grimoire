import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageUploadPanel from './ImageUploadPanel'
import { campaigns } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

vi.mock('../../api', () => ({
  campaigns: {
    listCategories: vi.fn(),
    uploadImage: vi.fn(),
  },
}))

type Categories = Awaited<ReturnType<typeof campaigns.listCategories>>
type Uploaded = Awaited<ReturnType<typeof campaigns.uploadImage>>

const CATEGORIES = [
  { id: 'c1', name: 'Handouts' },
  { id: 'c2', name: 'Maps' },
] as unknown as Categories

const pngFile = () => new File(['x'], 'x.png', { type: 'image/png' })

const props = (over = {}) => ({
  campaignId: 'camp7',
  onUploaded: vi.fn(),
  onCancel: vi.fn(),
  ...over,
})

const fileInput = () => screen.getByLabelText('wiki.chooseImage') as HTMLInputElement
const existingRadio = () => screen.getAllByRole('radio')[0] as HTMLInputElement
const newRadio = () => screen.getAllByRole('radio')[1] as HTMLInputElement
const uploadBtn = () => screen.getByRole('button', { name: /wiki.uploadAndEmbed/ })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(campaigns.listCategories).mockResolvedValue(CATEGORIES)
  vi.mocked(campaigns.uploadImage).mockResolvedValue({ id: 'img1' } as unknown as Uploaded)
})

describe('ImageUploadPanel', () => {
  it('lists the campaign resource categories and starts on "existing"', async () => {
    render(<ImageUploadPanel {...props()} />)
    expect(await screen.findByRole('option', { name: 'Maps' })).toBeInTheDocument()
    expect(campaigns.listCategories).toHaveBeenCalledWith('camp7', 'resource')
    expect(existingRadio().checked).toBe(true)
    expect(existingRadio()).not.toBeDisabled()
    expect(screen.getByLabelText('resources.categoryLabel')).not.toBeDisabled()
  })

  it('defaults to a new category when the campaign has none', async () => {
    vi.mocked(campaigns.listCategories).mockResolvedValue([] as unknown as Categories)
    render(<ImageUploadPanel {...props()} />)
    await waitFor(() => expect(newRadio().checked).toBe(true))
    expect(existingRadio()).toBeDisabled()
    expect(screen.getByLabelText('resources.categoryLabel')).toBeDisabled()
  })

  it('treats a null category list as empty', async () => {
    vi.mocked(campaigns.listCategories).mockResolvedValue(null as unknown as Categories)
    render(<ImageUploadPanel {...props()} />)
    await waitFor(() => expect(newRadio().checked).toBe(true))
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('falls back to no categories when the list fails to load', async () => {
    vi.mocked(campaigns.listCategories).mockRejectedValue(new Error('nope'))
    render(<ImageUploadPanel {...props()} />)
    await waitFor(() => expect(campaigns.listCategories).toHaveBeenCalled())
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(existingRadio()).toBeDisabled()
  })

  it('asks for an image when none was chosen', async () => {
    render(<ImageUploadPanel {...props()} />)
    await screen.findByRole('option', { name: 'Maps' })
    await userEvent.click(uploadBtn())
    expect(screen.getByText('wiki.chooseImage')).toBeInTheDocument()
    expect(campaigns.uploadImage).not.toHaveBeenCalled()
  })

  it('uploads into the chosen existing category', async () => {
    const p = props()
    render(<ImageUploadPanel {...p} />)
    await screen.findByRole('option', { name: 'Maps' })
    const file = pngFile()
    await userEvent.upload(fileInput(), file)
    await userEvent.selectOptions(screen.getByLabelText('resources.categoryLabel'), 'c2')
    await userEvent.click(uploadBtn())
    await waitFor(() => expect(p.onUploaded).toHaveBeenCalledWith({ id: 'img1' }))
    expect(campaigns.uploadImage).toHaveBeenCalledWith('camp7', file, { categoryId: 'c2' })
  })

  it('uploads with no filing when no existing category is picked', async () => {
    const p = props()
    render(<ImageUploadPanel {...p} />)
    await screen.findByRole('option', { name: 'Maps' })
    const file = pngFile()
    await userEvent.upload(fileInput(), file)
    await userEvent.click(uploadBtn())
    await waitFor(() => expect(p.onUploaded).toHaveBeenCalled())
    expect(campaigns.uploadImage).toHaveBeenCalledWith('camp7', file, {})
  })

  it('creates a new category from the trimmed name', async () => {
    const p = props()
    render(<ImageUploadPanel {...p} />)
    await screen.findByRole('option', { name: 'Maps' })
    const file = pngFile()
    await userEvent.upload(fileInput(), file)
    // Focusing the name field switches to "new category"; the upload stays
    // disabled until it holds a non-blank name.
    await userEvent.click(screen.getByLabelText('wiki.newCategoryPlaceholder'))
    expect(newRadio().checked).toBe(true)
    expect(uploadBtn()).toBeDisabled()
    await userEvent.type(screen.getByLabelText('wiki.newCategoryPlaceholder'), '  Portraits  ')
    expect(uploadBtn()).not.toBeDisabled()
    await userEvent.click(uploadBtn())
    await waitFor(() => expect(p.onUploaded).toHaveBeenCalled())
    expect(campaigns.uploadImage).toHaveBeenCalledWith('camp7', file, {
      newCategoryName: 'Portraits',
    })
  })

  it('switches between the radio modes', async () => {
    render(<ImageUploadPanel {...props()} />)
    await screen.findByRole('option', { name: 'Maps' })
    await userEvent.click(newRadio())
    expect(newRadio().checked).toBe(true)
    expect(screen.getByLabelText('resources.categoryLabel')).toBeDisabled()
    await userEvent.click(existingRadio())
    expect(existingRadio().checked).toBe(true)
  })

  it('shows the upload error and re-enables the button', async () => {
    vi.mocked(campaigns.uploadImage).mockRejectedValue(new Error('too big'))
    const p = props()
    render(<ImageUploadPanel {...p} />)
    await screen.findByRole('option', { name: 'Maps' })
    await userEvent.upload(fileInput(), pngFile())
    await userEvent.click(uploadBtn())
    expect(await screen.findByText('too big')).toBeInTheDocument()
    expect(uploadBtn()).not.toBeDisabled()
    expect(p.onUploaded).not.toHaveBeenCalled()
  })

  it('shows the uploading label while the upload is in flight', async () => {
    let resolve: (v: Uploaded) => void = () => {}
    vi.mocked(campaigns.uploadImage).mockReturnValue(
      new Promise<Uploaded>((r) => {
        resolve = r
      })
    )
    const p = props()
    render(<ImageUploadPanel {...p} />)
    await screen.findByRole('option', { name: 'Maps' })
    await userEvent.upload(fileInput(), pngFile())
    await userEvent.click(uploadBtn())
    const busyBtn = await screen.findByRole('button', { name: /resources.uploading/ })
    expect(busyBtn).toBeDisabled()
    resolve({ id: 'img1' } as unknown as Uploaded)
    await waitFor(() => expect(p.onUploaded).toHaveBeenCalled())
  })

  it('calls onCancel from the cancel button', async () => {
    const p = props()
    render(<ImageUploadPanel {...p} />)
    await screen.findByRole('option', { name: 'Maps' })
    await userEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(p.onCancel).toHaveBeenCalled()
  })
})
