import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserPermissionBadges from './UserPermissionBadges'

describe('UserPermissionBadges', () => {
  it('shows both badges when all permissions are granted', () => {
    render(<UserPermissionBadges allowExplicit campaignAccess />)
    expect(screen.getByText('Campaigns')).toBeInTheDocument()
    expect(screen.getByText('Explicit')).toBeInTheDocument()
  })

  it('shows only the campaign badge when explicit is off', () => {
    render(<UserPermissionBadges allowExplicit={false} campaignAccess />)
    expect(screen.getByText('Campaigns')).toBeInTheDocument()
    expect(screen.queryByText('Explicit')).not.toBeInTheDocument()
  })

  it('shows only the explicit badge when campaign access is off', () => {
    render(<UserPermissionBadges allowExplicit campaignAccess={false} />)
    expect(screen.queryByText('Campaigns')).not.toBeInTheDocument()
    expect(screen.getByText('Explicit')).toBeInTheDocument()
  })

  it('shows a "none" placeholder when no permissions are granted', () => {
    render(<UserPermissionBadges allowExplicit={false} campaignAccess={false} />)
    expect(screen.getByText('None')).toBeInTheDocument()
  })
})
