import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EnvironmentPanel from './EnvironmentPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const env = { baked_lighting: false, ambient_light: '00000000' }

describe('EnvironmentPanel', () => {
  it('toggles baked lighting', async () => {
    const onChange = vi.fn()
    render(<EnvironmentPanel environment={env} lightCount={0} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ baked_lighting: true }))
  })

  it('warns when lights are placed on an already-lit map', () => {
    // Importers may ignore or dampen lights when baked_lighting is set, so the
    // user needs to know which of the two they have.
    render(
      <EnvironmentPanel
        environment={{ ...env, baked_lighting: true }}
        lightCount={3}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('bakedWarning')
  })

  it('does not warn when baked lighting has no lights over it', () => {
    render(
      <EnvironmentPanel
        environment={{ ...env, baked_lighting: true }}
        lightCount={0}
        onChange={vi.fn()}
      />
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not warn about lights on an unbaked map', () => {
    render(<EnvironmentPanel environment={env} lightCount={5} onChange={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('writes ambient light back as ARGB', () => {
    const onChange = vi.fn()
    render(
      <EnvironmentPanel
        environment={{ ...env, ambient_light: '80ffffff' }}
        lightCount={0}
        onChange={onChange}
      />
    )
    fireEvent.change(screen.getByLabelText('maps.vtt.environment.ambient'), {
      target: { value: '#203040' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ambient_light: '80203040' }))
  })

  it('edits ambient strength as the alpha channel', () => {
    const onChange = vi.fn()
    render(<EnvironmentPanel environment={env} lightCount={0} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('maps.vtt.environment.ambientStrength'), {
      target: { value: '1' },
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ambient_light: 'ff000000' }))
  })
})
