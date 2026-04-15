import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RoleBadge, { ROLE_COLORS } from './RoleBadge'

describe('RoleBadge', () => {
  it('renders the role text for admin', () => {
    render(<RoleBadge role="admin" />)
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders the role text for gm', () => {
    render(<RoleBadge role="gm" />)
    expect(screen.getByText('GM')).toBeInTheDocument()
  })

  it('renders the role text for player', () => {
    render(<RoleBadge role="player" />)
    expect(screen.getByText('Player')).toBeInTheDocument()
  })

  it('renders without throwing for an unknown role', () => {
    render(<RoleBadge role="superadmin" />)
    expect(screen.getByText('superadmin')).toBeInTheDocument()
  })

  it('ROLE_COLORS defines entries for all three standard roles', () => {
    expect(ROLE_COLORS).toHaveProperty('admin')
    expect(ROLE_COLORS).toHaveProperty('gm')
    expect(ROLE_COLORS).toHaveProperty('player')
  })

  it('each ROLE_COLORS entry has bg, border, and text keys', () => {
    for (const role of ['admin', 'gm', 'player']) {
      expect(ROLE_COLORS[role]).toHaveProperty('bg')
      expect(ROLE_COLORS[role]).toHaveProperty('border')
      expect(ROLE_COLORS[role]).toHaveProperty('text')
    }
  })
})
