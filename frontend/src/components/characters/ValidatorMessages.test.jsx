import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ValidatorMessages from './ValidatorMessages'

describe('ValidatorMessages', () => {
  it('renders nothing when no validator fired', () => {
    const { container } = render(<ValidatorMessages results={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a message per result', () => {
    render(
      <ValidatorMessages
        results={[
          { rule: 'a', message: 'Too many spells', severity: 'warning' },
          { rule: 'b', message: 'Level is invalid', severity: 'error' },
        ]}
      />
    )
    expect(screen.getByText('Too many spells')).toBeInTheDocument()
    expect(screen.getByText('Level is invalid')).toBeInTheDocument()
  })

  it('puts errors before warnings', () => {
    render(
      <ValidatorMessages
        results={[
          { rule: 'a', message: 'just a warning', severity: 'warning' },
          { rule: 'b', message: 'a real error', severity: 'error' },
        ]}
      />
    )
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('a real error')
    expect(items[1]).toHaveTextContent('just a warning')
  })

  it('announces an error assertively and a warning politely', () => {
    render(
      <ValidatorMessages
        results={[
          { rule: 'a', message: 'error text', severity: 'error' },
          { rule: 'b', message: 'warning text', severity: 'warning' },
        ]}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('error text')
    expect(screen.getByRole('status')).toHaveTextContent('warning text')
  })

  it('renders defensively when results is missing', () => {
    const { container } = render(<ValidatorMessages />)
    expect(container).toBeEmptyDOMElement()
  })
})
