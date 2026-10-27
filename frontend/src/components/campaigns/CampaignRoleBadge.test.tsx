import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CampaignRoleBadge from './CampaignRoleBadge'

describe('CampaignRoleBadge', () => {
  it('renders the label', () => {
    render(<CampaignRoleBadge label="Game Master" />)
    expect(screen.getByText('Game Master')).toBeInTheDocument()
  })
})
