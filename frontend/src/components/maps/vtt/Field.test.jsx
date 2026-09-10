import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Field from './Field'

describe('Field', () => {
  it('labels its control', () => {
    render(
      <Field label="Range">
        <input aria-label="Range" />
      </Field>
    )
    expect(screen.getByText('Range')).toBeInTheDocument()
    expect(screen.getByLabelText('Range')).toBeInTheDocument()
  })

  it('merges an extra style', () => {
    const { container } = render(
      <Field label="X" style={{ flex: 1 }}>
        <input />
      </Field>
    )
    expect(container.querySelector('label')).toHaveStyle({ flex: 1 })
  })
})
