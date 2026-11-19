import { describe, expect, it } from 'vitest'
import { oidcLoginUrl } from './oidcLogin'

const at = (pathname: string, search = '') => oidcLoginUrl({ pathname, search })
const returnTo = (url: string) =>
  new URL(url, 'https://grimoire.test').searchParams.get('return_to')

describe('oidcLoginUrl', () => {
  it('comes back to the page that asked for sign-in', () => {
    expect(returnTo(at('/oauth/consent', '?request=abc123'))).toBe('/oauth/consent?request=abc123')
    expect(returnTo(at('/library/book/42'))).toBe('/library/book/42')
  })

  it('encodes the return address as one parameter', () => {
    const url = at('/search', '?q=fire+ball&system=3')
    expect(url.startsWith('/api/auth/openid/login?return_to=')).toBe(true)
    expect(returnTo(url)).toBe('/search?q=fire+ball&system=3')
  })

  it('asks for nothing from the home page', () => {
    expect(at('/')).toBe('/api/auth/openid/login')
  })

  it('never comes back to a sign-in page', () => {
    expect(at('/login')).toBe('/api/auth/openid/login')
    expect(at('/login', '?oidc_error=denied')).toBe('/api/auth/openid/login')
    expect(at('/guest', '?code=XYZ')).toBe('/api/auth/openid/login')
  })

  it("drops the sign-in page's own parameters", () => {
    expect(returnTo(at('/library', '?autoLaunch=0&shelf=2'))).toBe('/library?shelf=2')
    expect(at('/', '?oidc_error=denied&autoLaunch=0')).toBe('/api/auth/openid/login')
  })
})
