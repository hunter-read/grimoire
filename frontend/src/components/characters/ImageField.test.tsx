import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageField from './ImageField'
import { CharacterMediaContext } from './characterMedia'
import type { CharacterMedia } from './characterMedia'

const mockUpload = vi.fn()
const mockDelete = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    imageUrl: (id: string, field: string, v?: string) =>
      `/api/characters/${id}/images/${field}?v=${v}`,
    uploadImage: (...a: unknown[]) => mockUpload(...a),
    deleteImage: (...a: unknown[]) => mockDelete(...a),
  },
}))

const VALUE = 'arms-0123456789abcdef.png'
const png = () => new File(['x'], 'arms.png', { type: 'image/png' })

const media = (overrides: Partial<CharacterMedia> = {}): CharacterMedia => ({
  character: { id: 'c1', name: 'Vex' },
  readOnly: false,
  onPortraitChanged: vi.fn(),
  onImageChanged: vi.fn(),
  onError: vi.fn(),
  openPortrait: vi.fn(),
  ...overrides,
})

const renderField = (
  value: CharacterMedia | null,
  props: Partial<{ value: unknown; readOnly: boolean; hideLabel: boolean }> = {}
) =>
  render(
    <CharacterMediaContext.Provider value={value}>
      <ImageField name="arms" label="Coat of Arms" {...props} />
    </CharacterMediaContext.Provider>
  )

beforeEach(() => vi.clearAllMocks())

describe('ImageField', () => {
  it('shows the picture under its stored name', () => {
    renderField(media(), { value: VALUE })
    expect(screen.getByRole('img', { name: 'Coat of Arms' })).toHaveAttribute(
      'src',
      `/api/characters/c1/images/arms?v=${VALUE}`
    )
    expect(screen.getByRole('group', { name: 'Coat of Arms' })).toBeInTheDocument()
  })

  it('uploads a picture and reports its new name', async () => {
    mockUpload.mockResolvedValue({ field: 'arms', value: VALUE })
    const value = media()
    renderField(value)
    expect(screen.getByRole('button', { name: 'Add image' })).toBeInTheDocument()
    const input = screen.getByLabelText('Choose a picture for Coat of Arms') as HTMLInputElement
    await userEvent.upload(input, png())
    expect(mockUpload).toHaveBeenCalledWith('c1', 'arms', expect.any(File))
    await waitFor(() => expect(value.onImageChanged).toHaveBeenCalledWith('arms', VALUE))
    expect(input.value).toBe('')
  })

  it('opens the picker from the add button', async () => {
    renderField(media())
    const input = screen.getByLabelText('Choose a picture for Coat of Arms')
    const click = vi.spyOn(input, 'click')
    await userEvent.click(screen.getByRole('button', { name: 'Add image' }))
    expect(click).toHaveBeenCalled()
  })

  it('replaces and removes a picture', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockDelete.mockResolvedValue({})
    const value = media()
    renderField(value, { value: VALUE })
    const input = screen.getByLabelText('Choose a picture for Coat of Arms')
    const click = vi.spyOn(input, 'click')
    await userEvent.click(screen.getByRole('button', { name: 'Replace Coat of Arms' }))
    expect(click).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Coat of Arms' }))
    expect(mockDelete).toHaveBeenCalledWith('c1', 'arms')
    await waitFor(() => expect(value.onImageChanged).toHaveBeenCalledWith('arms', null))
  })

  it('keeps the picture when removal is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderField(media(), { value: VALUE })
    await userEvent.click(screen.getByRole('button', { name: 'Remove Coat of Arms' }))
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('reports failures', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockUpload.mockRejectedValue(new Error('too big'))
    mockDelete.mockRejectedValue(new Error('gone'))
    const value = media()
    renderField(value, { value: VALUE })
    await userEvent.upload(screen.getByLabelText('Choose a picture for Coat of Arms'), png())
    await waitFor(() => expect(value.onError).toHaveBeenCalledWith('too big'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Coat of Arms' }))
    await waitFor(() => expect(value.onError).toHaveBeenCalledWith('gone'))
  })

  it('offers no controls on a read-only sheet', () => {
    renderField(media({ readOnly: true }), { value: VALUE })
    expect(screen.getByRole('img', { name: 'Coat of Arms' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says there is no image when read-only and empty', () => {
    renderField(media(), { readOnly: true })
    expect(screen.getByText('No image')).toBeInTheDocument()
  })

  it('draws as unavailable outside a character', () => {
    renderField(null, { value: VALUE, hideLabel: true })
    expect(screen.getByText('No image')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Coat of Arms')).not.toBeVisible()
  })
})
