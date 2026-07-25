import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BattlesView from './BattlesView'

function renderView() {
  return render(
    <MemoryRouter>
      <BattlesView />
    </MemoryRouter>
  )
}

describe('BattlesView', () => {
  it('renders the header and section titles', () => {
    renderView()
    expect(screen.getByText('Battles')).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByText('Recent Results')).toBeInTheDocument()
  })

  it('renders the sample upcoming battles', () => {
    renderView()
    expect(screen.getByText('The Broken Spire')).toBeInTheDocument()
    expect(screen.getByText('Ford at Gray River')).toBeInTheDocument()
    expect(screen.getByText('Strike Force Ultima')).toBeInTheDocument()
  })

  it('renders recent results with their outcomes', () => {
    renderView()
    expect(screen.getByText('Siege of Karn')).toBeInTheDocument()
    expect(screen.getByText('Victory')).toBeInTheDocument()
    expect(screen.getByText('Defeat')).toBeInTheDocument()
    expect(screen.getByText('Draw')).toBeInTheDocument()
  })
})
