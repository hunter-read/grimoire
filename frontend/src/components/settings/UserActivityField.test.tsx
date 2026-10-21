import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UserActivityField from './UserActivityField'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en-US' } }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

const renderField = (props: Partial<Parameters<typeof UserActivityField>[0]> = {}) =>
  render(<UserActivityField username="al ice" {...props} />, { wrapper: MemoryRouter })

describe('UserActivityField', () => {
  it('shows when the account signed in and was last active', () => {
    renderField({ lastLoginAt: '2026-10-20T12:00:00', lastActiveAt: '2026-10-21T11:00:00' })
    expect(screen.getByText('users.activity.label')).toBeInTheDocument()
    const [login, active] = screen.getAllByRole('time')
    expect(login.getAttribute('datetime')).toBe('2026-10-20T12:00:00.000Z')
    expect(login.textContent).toMatch(/2026/)
    expect(login.title).toBe('yesterday')
    expect(active.title).toBe('1 hour ago')
  })

  it('says never for both when the account has not signed in', () => {
    renderField()
    expect(screen.getAllByText('users.activity.never')).toHaveLength(2)
  })

  it('links to the logs narrowed to the user without toggling the row', () => {
    const onRowClick = vi.fn()
    render(
      <MemoryRouter>
        <div onClick={onRowClick}>
          <UserActivityField username="al ice" />
        </div>
      </MemoryRouter>
    )
    const link = screen.getByRole('link', { name: 'users.activity.viewLogs' })
    expect(link.getAttribute('href')).toBe('/settings/logs?user=al%20ice')
    fireEvent.mouseEnter(link)
    expect(link.style.textDecoration).toBe('underline')
    fireEvent.mouseLeave(link)
    expect(link.style.textDecoration).toBe('none')
    fireEvent.click(link)
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
