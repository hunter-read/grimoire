import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ParentSystemManagerSection from './ParentSystemManagerSection'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

// Assert the wrapper wires the parent-systems endpoint/listKey through.
vi.mock('./SimpleLookupManager', () => ({
  default: ({ endpoint, listKey }) => (
    <div data-testid="mgr" data-endpoint={endpoint} data-listkey={listKey} />
  ),
}))

describe('ParentSystemManagerSection', () => {
  it('renders SimpleLookupManager pointed at /parent-systems', () => {
    render(<ParentSystemManagerSection />)
    const mgr = screen.getByTestId('mgr')
    expect(mgr).toHaveAttribute('data-endpoint', '/parent-systems')
    expect(mgr).toHaveAttribute('data-listkey', 'parent_systems')
  })
})
