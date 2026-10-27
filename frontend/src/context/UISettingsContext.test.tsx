import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UISettingsProvider, useUISettings } from './UISettingsContext'

function Probe() {
  const ui = useUISettings()
  return <div data-testid="probe">{JSON.stringify(ui)}</div>
}

describe('UISettingsContext', () => {
  it('provides default values when no provider wraps it', () => {
    render(<Probe />)
    const value = JSON.parse(screen.getByTestId('probe').textContent)
    expect(value.hide_audio).toBe(false)
    expect(value.hide_maps).toBe(false)
  })

  it('exposes the provided settings (incl. hide_audio)', () => {
    render(
      <UISettingsProvider value={{ hide_maps: true, hide_audio: true, hide_campaigns: false }}>
        <Probe />
      </UISettingsProvider>
    )
    const value = JSON.parse(screen.getByTestId('probe').textContent)
    expect(value.hide_audio).toBe(true)
    expect(value.hide_maps).toBe(true)
    expect(value.hide_campaigns).toBe(false)
  })
})
