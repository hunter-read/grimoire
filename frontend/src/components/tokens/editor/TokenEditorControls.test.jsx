import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TokenEditorControls from './TokenEditorControls'

const transform = (overrides = {}) => ({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  ...overrides,
})

const setup = (props = {}) => {
  const actions = {
    setScale: vi.fn(),
    setRotation: vi.fn(),
    rotate: vi.fn(),
    flipX: vi.fn(),
    flipY: vi.fn(),
    reset: vi.fn(),
  }
  const onMaskChange = vi.fn()
  const onSizeChange = vi.fn()
  const onBackgroundChange = vi.fn()
  render(
    <TokenEditorControls
      mask="circle"
      onMaskChange={onMaskChange}
      size={256}
      sizes={[140, 256, 512, 1024]}
      onSizeChange={onSizeChange}
      background="transparent"
      onBackgroundChange={onBackgroundChange}
      transform={transform()}
      actions={actions}
      onFrameColorChange={vi.fn()}
      {...props}
    />
  )
  return { actions, onMaskChange, onSizeChange, onBackgroundChange }
}

describe('TokenEditorControls', () => {
  it('marks the active mask and reports a change', async () => {
    const { onMaskChange } = setup()
    expect(screen.getByRole('button', { name: 'Circle' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Square' }))
    expect(onMaskChange).toHaveBeenCalledWith('square')
  })

  it('offers every output size and reports the choice as a number', async () => {
    const { onSizeChange } = setup()
    const select = screen.getByLabelText('Output size')
    expect(select).toHaveValue('256')
    await userEvent.selectOptions(select, '512')
    expect(onSizeChange).toHaveBeenCalledWith(512)
  })

  it('drives zoom from the slider', () => {
    const { actions } = setup()
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '3' } })
    expect(actions.setScale).toHaveBeenCalledWith(3)
  })

  it('nudges rotation by fifteen degrees in each direction', async () => {
    const { actions } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Rotate right' }))
    expect(actions.rotate).toHaveBeenCalledWith(15)
    await userEvent.click(screen.getByRole('button', { name: 'Rotate left' }))
    expect(actions.rotate).toHaveBeenLastCalledWith(-15)
  })

  it('sets rotation absolutely from the slider', () => {
    const { actions } = setup()
    fireEvent.change(screen.getByLabelText('Rotation'), { target: { value: '90' } })
    expect(actions.setRotation).toHaveBeenCalledWith(90)
  })

  it('toggles both flips and resets', async () => {
    const { actions } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Flip horizontally' }))
    await userEvent.click(screen.getByRole('button', { name: 'Flip vertically' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset position' }))
    expect(actions.flipX).toHaveBeenCalled()
    expect(actions.flipY).toHaveBeenCalled()
    expect(actions.reset).toHaveBeenCalled()
  })

  it('shows which flips are active', () => {
    setup({ transform: transform({ flipX: true }) })
    expect(screen.getByRole('button', { name: 'Flip horizontally' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Flip vertically' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('reports a background choice as a colour token', async () => {
    const { onBackgroundChange } = setup()
    await userEvent.click(screen.getAllByRole('button', { name: 'Blue' })[0])
    expect(onBackgroundChange).toHaveBeenCalledWith('blue')
  })

  it('marks the active background', () => {
    setup({ background: 'blue' })
    expect(screen.getAllByRole('button', { name: 'Blue' })[0]).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('offers transparency as the background default', async () => {
    const { onBackgroundChange } = setup({ background: 'blue' })
    await userEvent.click(screen.getByRole('button', { name: 'Transparent' }))
    expect(onBackgroundChange).toHaveBeenCalledWith('')
  })

  it('hides the shape control when the frame supplies the crop', () => {
    // The frame's own opening is the token's shape then, so a control that no
    // longer changes anything would read as broken.
    setup({ maskFromFrame: true })
    expect(screen.queryByRole('button', { name: 'Circle' })).not.toBeInTheDocument()
  })

  it('shows the shape control again with no frame selected', () => {
    setup({ maskFromFrame: false })
    expect(screen.getByRole('button', { name: 'Circle' })).toBeInTheDocument()
  })

  it('offers a frame colour only for the recolourable shapes', async () => {
    const onFrameColorChange = vi.fn()
    setup({ frameRecolourable: true, frameColor: 'gold', onFrameColorChange })
    expect(screen.getByText('Frame colour')).toBeInTheDocument()

    // Two swatch rows exist once a generic frame is selected; the frame's is
    // the second, after the background's.
    await userEvent.click(screen.getAllByRole('button', { name: 'Red' })[1])
    expect(onFrameColorChange).toHaveBeenCalledWith('red')
  })

  it('hides the frame colour for a themed or user frame', () => {
    setup({ frameRecolourable: false })
    expect(screen.queryByText('Frame colour')).not.toBeInTheDocument()
  })

  it('surfaces a low-resolution warning when given one', () => {
    setup({ sourceWarning: 'too small' })
    expect(screen.getByText('too small')).toBeInTheDocument()
  })

  it('goes inert when disabled', () => {
    const { container } = render(
      <TokenEditorControls
        mask="circle"
        onMaskChange={vi.fn()}
        size={256}
        sizes={[256]}
        background="transparent"
        onBackgroundChange={vi.fn()}
        transform={transform()}
        actions={{
          setScale: vi.fn(),
          setRotation: vi.fn(),
          rotate: vi.fn(),
          flipX: vi.fn(),
          flipY: vi.fn(),
          reset: vi.fn(),
        }}
        disabled
      />
    )
    expect(container.firstChild).toHaveStyle({ pointerEvents: 'none' })
  })
})
