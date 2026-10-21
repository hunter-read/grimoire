import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserLastActive from './UserLastActive'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, string>) => (o?.when ? `${k}:${o.when}` : k),
    i18n: { language: 'en-US' },
  }),
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UserLastActive', () => {
  it('says never for an account that has not been seen', () => {
    render(<UserLastActive lastActiveAt={null} lastLoginAt={null} />)
    expect(screen.getByText('users.activity.never')).toBeInTheDocument()
  })

  it('shows relative time with the exact times on hover', () => {
    render(<UserLastActive lastActiveAt="2026-10-21T09:00:00" lastLoginAt="2026-10-20T08:00:00" />)
    const time = screen.getByText('3 hours ago')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('datetime')).toBe('2026-10-21T09:00:00.000Z')
    expect(time.title).toContain('users.activity.lastActiveAt:')
    expect(time.title).toContain('users.activity.lastLoginAt:')
    expect(time.style.color).toBe('var(--text)')
  })

  it('fades activity as it ages and omits a missing sign-in from the tooltip', () => {
    render(<UserLastActive lastActiveAt="2026-06-01T09:00:00" />)
    const time = screen.getByText('5 months ago')
    expect(time.style.color).toBe('var(--text-muted)')
    expect(time.title).not.toContain('lastLoginAt')
  })
})
