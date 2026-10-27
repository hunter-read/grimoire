import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LicenseManagerSection from './LicenseManagerSection'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

vi.mock('./SimpleLookupManager', () => ({
  default: ({ endpoint, listKey }: { endpoint: string; listKey: string }) => (
    <div data-testid="mgr" data-endpoint={endpoint} data-listkey={listKey} />
  ),
}))

describe('LicenseManagerSection', () => {
  it('renders SimpleLookupManager pointed at /licenses', () => {
    render(<LicenseManagerSection />)
    const mgr = screen.getByTestId('mgr')
    expect(mgr).toHaveAttribute('data-endpoint', '/licenses')
    expect(mgr).toHaveAttribute('data-listkey', 'licenses')
  })
})
