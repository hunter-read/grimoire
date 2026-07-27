import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SectionDivider from './SectionDivider'

describe('SectionDivider', () => {
  it('renders a bordered divider', () => {
    const { container } = render(<SectionDivider />)
    expect(container.firstChild.style.borderTop).toBe('1px solid var(--border)')
  })
})
