import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OidcLoginButton from './OidcLoginButton'

describe('OidcLoginButton', () => {
  it('renders the label with the theme look when nothing is configured', () => {
    const onClick = vi.fn()
    const { container } = render(<OidcLoginButton label="Sign in with SSO" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Sign in with SSO' })
    expect(btn.style.background).toBe('var(--bg-card)')
    expect(btn.style.borderColor).toBe('var(--border)')
    expect(btn.style.borderRadius).toBe('8px')
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
  })

  it('applies the configured colors, radius and icon', () => {
    const { container } = render(
      <OidcLoginButton
        label="Sign in with Google"
        bgColor="#131314"
        textColor="#E3E3E3"
        borderColor=" #8e918f "
        radius={20}
        iconUrl="/api/auth/openid/button-icon?v=abc"
      />
    )
    const btn = screen.getByRole('button', { name: 'Sign in with Google' })
    expect(btn.style.background).toBe('rgb(19, 19, 20)')
    expect(btn.style.color).toBe('rgb(227, 227, 227)')
    expect(btn.style.borderColor).toBe('rgb(142, 145, 143)')
    expect(btn.style.borderRadius).toBe('20px')
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toBe('/api/auth/openid/button-icon?v=abc')
    expect(img.getAttribute('alt')).toBe('')
  })

  it('accepts a radius given as a string, including zero', () => {
    render(<OidcLoginButton label="Go" radius="0" />)
    expect(screen.getByRole('button').style.borderRadius).toBe('0px')
  })

  it('ignores values that are not hex colors or an in-range radius', () => {
    render(
      <OidcLoginButton
        label="Go"
        bgColor="red; position: fixed"
        textColor="url(x)"
        borderColor="#12"
        radius="99"
      />
    )
    const btn = screen.getByRole('button')
    expect(btn.style.background).toBe('var(--bg-card)')
    expect(btn.style.color).toBe('var(--text)')
    expect(btn.style.borderColor).toBe('var(--border)')
    expect(btn.style.borderRadius).toBe('8px')
  })

  it('hides an icon that fails to load, and retries a new URL', () => {
    const { container, rerender } = render(<OidcLoginButton label="Go" iconUrl="/icon?v=1" />)
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull()
    rerender(<OidcLoginButton label="Go" iconUrl="/icon?v=2" />)
    expect(container.querySelector('img').getAttribute('src')).toBe('/icon?v=2')
  })
})
