import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LightProperties from './LightProperties'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const light = {
  position: { x: 3, y: 4 },
  range: 4,
  intensity: 1,
  color: 'ffeccd8b',
  shadows: true,
}

describe('LightProperties', () => {
  it('shows the colour as RGB with the alpha pair stripped', () => {
    // Alpha leads in the stored value; showing #ffeccd here would be the
    // classic ARGB-order bug.
    render(<LightProperties light={light} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('maps.vtt.light.color')).toHaveValue('#eccd8b')
  })

  it('reports opacity from the alpha channel', () => {
    render(
      <LightProperties
        light={{ ...light, color: '80eccd8b' }}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(Number(screen.getByLabelText('maps.vtt.light.opacity').value)).toBeCloseTo(0.502, 2)
  })

  it('writes the colour back as ARGB', () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.light.color'), {
      target: { value: '#102030' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: 'ff102030' }))
  })

  it('keeps the existing alpha when only the hue changes', () => {
    const onChange = vi.fn()
    render(
      <LightProperties
        light={{ ...light, color: '80eccd8b' }}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('maps.vtt.light.color'), {
      target: { value: '#102030' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: '80102030' }))
  })

  it('edits the range in grid squares', async () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.light.range +0.5'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ range: 4.5 }))
  })

  it('never lets range go negative', async () => {
    const onChange = vi.fn()
    render(
      <LightProperties light={{ ...light, range: 0 }} onChange={onChange} onDelete={vi.fn()} />
    )
    await userEvent.click(screen.getByLabelText('maps.vtt.light.range -0.5'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ range: 0 }))
  })

  it('toggles shadows', async () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ shadows: false }))
  })

  it('moves the light by its coordinates', async () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.light.x +0.5'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ position: { x: 3.5, y: 4 } }))
  })

  it('moves the light vertically too', async () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.light.y -0.5'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ position: { x: 3, y: 3.5 } }))
  })

  it('edits intensity', () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.light.intensity'), {
      target: { value: '1.5' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ intensity: 1.5 }))
  })

  it('edits opacity as the alpha channel, keeping the hue', () => {
    const onChange = vi.fn()
    render(<LightProperties light={light} onChange={onChange} onDelete={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.light.opacity'), { target: { value: '0.5' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: '80eccd8b' }))
  })

  it('deletes on request', async () => {
    const onDelete = vi.fn()
    render(<LightProperties light={light} onChange={vi.fn()} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /deleteSelected/ }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('offers no control the format cannot carry', () => {
    // No animation, falloff, colour temperature or dim/bright split: a .uvtt
    // cannot express them, so a control would promise what export cannot keep.
    const { container } = render(
      <LightProperties light={light} onChange={vi.fn()} onDelete={vi.fn()} />
    )
    const labels = Array.from(container.querySelectorAll('input')).map((i) =>
      i.getAttribute('aria-label')
    )
    expect(labels.join(' ')).not.toMatch(/animation|falloff|temperature|dim|bright/i)
  })
})
