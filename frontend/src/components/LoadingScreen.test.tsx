import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LoadingScreen from './LoadingScreen'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

describe('LoadingScreen', () => {
  it('shows the app name above a loading spinner', () => {
    render(<LoadingScreen />)
    expect(screen.getByRole('heading', { name: 'app.name' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  })
})
