import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PortraitDialog from './PortraitDialog'
import type { PortraitCharacter } from './characterMedia'

const mockUpdate = vi.fn()
const mockUpload = vi.fn()
const mockDelete = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    portraitUrl: (id: string, v?: number) => `/api/characters/${id}/portrait${v ? `?v=${v}` : ''}`,
    update: (...a: unknown[]) => mockUpdate(...a),
    uploadPortrait: (...a: unknown[]) => mockUpload(...a),
    deletePortrait: (...a: unknown[]) => mockDelete(...a),
  },
}))

const WITH_ART: PortraitCharacter = {
  id: 'c1',
  name: 'Vex',
  portrait_path: 'c1.png',
  portrait_version: 5,
  portrait_crop: null,
}

const renderDialog = (props: Partial<Parameters<typeof PortraitDialog>[0]> = {}) => {
  const handlers = { onChanged: vi.fn(), onError: vi.fn(), onClose: vi.fn() }
  const view = render(<PortraitDialog character={WITH_ART} {...handlers} {...props} />)
  return { ...handlers, ...view }
}

// jsdom lays nothing out, so the picture is given a size to press on.
const sizePicture = () => {
  const image = screen.getByAltText('Portrait of Vex')
  image.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400 }) as DOMRect
  return image
}

beforeEach(() => vi.clearAllMocks())

describe('PortraitDialog', () => {
  it('shows a party member the art large, with nothing to change', () => {
    renderDialog({ readOnly: true })
    expect(screen.getByRole('dialog', { name: 'Art for Vex' })).toBeInTheDocument()
    expect(screen.getByAltText('Portrait of Vex')).toHaveAttribute(
      'src',
      '/api/characters/c1/portrait?v=5'
    )
    expect(screen.queryByRole('button', { name: 'Save framing' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Focus point/ })).not.toBeInTheDocument()
  })

  it('sets the focus where the picture is pressed and saves it', async () => {
    mockUpdate.mockResolvedValue({ portrait_crop: { x: 25, y: 10, zoom: 1 } })
    const { onChanged, onClose } = renderDialog()
    const save = screen.getByRole('button', { name: 'Save framing' })
    expect(save).toBeDisabled()
    sizePicture()
    const area = screen.getByRole('group', { name: /Focus point/ })
    fireEvent.pointerDown(area, { clientX: 50, clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(area, { clientX: 50, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(area, { pointerId: 1 })
    // Moving without a press does nothing.
    fireEvent.pointerMove(area, { clientX: 190, clientY: 390, pointerId: 1 })
    expect(save).toBeEnabled()
    await userEvent.click(save)
    expect(mockUpdate).toHaveBeenCalledWith('c1', { portrait_crop: { x: 25, y: 10, zoom: 1 } })
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({ portrait_crop: { x: 25, y: 10, zoom: 1 } })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('moves the focus with the arrow keys, zooms, and previews it', () => {
    renderDialog()
    const area = screen.getByRole('group', { name: /Focus point/ })
    fireEvent.keyDown(area, { key: 'ArrowUp' })
    fireEvent.keyDown(area, { key: 'ArrowUp' })
    fireEvent.keyDown(area, { key: 'ArrowLeft' })
    fireEvent.keyDown(area, { key: 'ArrowRight' })
    fireEvent.keyDown(area, { key: 'ArrowRight' })
    fireEvent.keyDown(area, { key: 'ArrowDown' })
    fireEvent.keyDown(area, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } })
    const previews = screen.getAllByRole('presentation') as HTMLImageElement[]
    expect(previews).toHaveLength(2)
    expect(previews[0].style.objectPosition).toBe('52% 48%')
    expect(previews[0].style.transform).toBe('scale(2)')
  })

  it('puts the framing back to centred', async () => {
    renderDialog({ character: { ...WITH_ART, portrait_crop: { x: 10, y: 0, zoom: 3 } } })
    const save = screen.getByRole('button', { name: 'Save framing' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Center' }))
    expect(save).toBeEnabled()
  })

  it('ignores a press before the picture has a size', () => {
    renderDialog()
    const image = screen.getByAltText('Portrait of Vex')
    image.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect
    fireEvent.pointerDown(screen.getByRole('group', { name: /Focus point/ }), {
      clientX: 5,
      clientY: 5,
    })
    expect(screen.getByRole('button', { name: 'Save framing' })).toBeDisabled()
  })

  it('reports a framing that failed to save', async () => {
    mockUpdate.mockRejectedValue(new Error('offline'))
    const { onError, onClose } = renderDialog()
    fireEvent.keyDown(screen.getByRole('group', { name: /Focus point/ }), { key: 'ArrowUp' })
    await userEvent.click(screen.getByRole('button', { name: 'Save framing' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('offline'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('replaces the art, and the framing starts over with it', async () => {
    mockUpload.mockResolvedValue({ portrait_path: 'c1.png', portrait_version: 6 })
    const { onChanged, rerender } = renderDialog()
    fireEvent.keyDown(screen.getByRole('group', { name: /Focus point/ }), { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Save framing' })).toBeEnabled()
    await userEvent.upload(
      screen.getByLabelText('Change art', { selector: 'input' }),
      new File(['x'], 'p.png', { type: 'image/png' })
    )
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({
        portrait_path: 'c1.png',
        portrait_version: 6,
        portrait_crop: null,
      })
    )
    rerender(
      <PortraitDialog
        character={{ ...WITH_ART, portrait_version: 6 }}
        onChanged={onChanged}
        onError={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Save framing' })).toBeDisabled()
  })

  it('opens the file picker from the replace button', async () => {
    renderDialog()
    const click = vi.spyOn(screen.getByLabelText('Change art', { selector: 'input' }), 'click')
    await userEvent.click(screen.getByRole('button', { name: 'Change art' }))
    expect(click).toHaveBeenCalled()
  })

  it('closes once the art is removed, but not when that is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockDelete.mockResolvedValue({})
    const { onClose, onChanged } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Remove art' }))
    expect(onClose).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Remove art' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onChanged).toHaveBeenCalledWith({
      portrait_path: null,
      portrait_version: null,
      portrait_crop: null,
    })
  })

  it('reports a removal that failed and stays open', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockDelete.mockRejectedValue(new Error('gone'))
    const { onClose, onError } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Remove art' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('gone'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('invites adding art when there is none', () => {
    renderDialog({ character: { id: 'c1', name: 'Vex', portrait_path: null } })
    expect(screen.getByText('No art yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add art' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove art' })).not.toBeInTheDocument()
  })
})
