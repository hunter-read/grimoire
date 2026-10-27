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
  const onSizeChange = vi.fn()
  const onBackgroundChange = vi.fn()
  render(
    <TokenEditorControls
      size={256}
      sizes={[140, 256, 512, 1024]}
      onSizeChange={onSizeChange}
      background="transparent"
      onBackgroundChange={onBackgroundChange}
      transform={transform()}
      actions={actions}
      {...props}
    />
  )
  return { actions, onSizeChange, onBackgroundChange }
}

describe('TokenEditorControls', () => {
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

  it('leaves the token shape to the frame picker', () => {
    // The frame list already offers a plain circle and square, so a separate
    // Shape control was two ways to say one thing.
    setup()
    expect(screen.queryByRole('button', { name: 'Circle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Square' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Full' })).not.toBeInTheDocument()
  })

  it('leaves the frame colour to the frame picker, beside the frames it recolours', () => {
    setup()
    expect(screen.queryByText('Frame colour')).not.toBeInTheDocument()
    // The background swatch row is still this component's.
    expect(screen.getByText('Background')).toBeInTheDocument()
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
