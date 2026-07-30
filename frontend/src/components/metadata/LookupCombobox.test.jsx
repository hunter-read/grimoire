import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LookupCombobox from './LookupCombobox'

function Harness() {
  const [v, setV] = useState('')
  return (
    <LookupCombobox
      id="fam"
      value={v}
      onChange={setV}
      options={['Fate', 'GURPS']}
      placeholder="family"
    />
  )
}

describe('LookupCombobox', () => {
  it('renders options in a datalist', () => {
    render(<Harness />)
    const list = document.getElementById('fam-options')
    expect(list.querySelectorAll('option')).toHaveLength(2)
  })

  it('accepts typed custom values', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByPlaceholderText('family'), 'Custom Engine')
    expect(screen.getByPlaceholderText('family').value).toBe('Custom Engine')
  })
})
