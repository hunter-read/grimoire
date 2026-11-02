import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingToggle from './SettingToggle'

describe('SettingToggle', () => {
  it('is a labelled checkbox described by its hint', () => {
    const onChange = vi.fn()
    render(
      <SettingToggle
        id="t"
        checked={false}
        onChange={onChange}
        label="Show maps"
        hint="Adds a tab"
      />
    )
    const box = screen.getByRole('checkbox', { name: 'Show maps' })
    expect(box).toHaveAccessibleDescription('Adds a tab')
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('has no description without a hint', () => {
    render(<SettingToggle id="t" checked onChange={() => {}} label="Show maps" />)
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-describedby')
  })
})
