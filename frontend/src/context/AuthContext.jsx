import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { auth as authApi, refreshAccessToken } from '../api'

// status: 'loading' | 'uninitialized' | 'unauthenticated' | 'authenticated'
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('grimoire_token')

    // Validate the stored token, falling back to a refresh. Access tokens are
    // short-lived (issue #157), so a returning user almost always arrives with
    // an expired one — that must resume the session from the refresh cookie
    // rather than bounce them to the login screen.
    const resolveSession = async () => {
      let active = token
      if (active) {
        const me = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${active}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        if (me) return me
        // The stored token is no good. Drop it now rather than at the end of
        // this chain, so we never leave a rejected token sitting in storage if
        // the refresh below fails or throws.
        localStorage.removeItem('grimoire_token')
      }

      // Either there was no token or it was rejected. A live refresh cookie
      // still resumes the session; anything else means genuinely logged out.
      active = await refreshAccessToken()
      if (!active) return null
      return fetch('/api/auth/me', { headers: { Authorization: `Bearer ${active}` } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    }

    fetch('/api/auth/status')
      .then((r) => r.json())
      .then(({ initialized }) => {
        if (!initialized) {
          setStatus('uninitialized')
          return
        }
        return resolveSession().then((userData) => {
          if (userData) {
            setUser(userData)
            setStatus('authenticated')
          } else {
            localStorage.removeItem('grimoire_token')
            setStatus('unauthenticated')
          }
        })
      })
      .catch(() => setStatus('unauthenticated'))

    const handleUnauthorized = () => {
      localStorage.removeItem('grimoire_token')
      setUser(null)
      setStatus('unauthenticated')
    }
    window.addEventListener('grimoire:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('grimoire:unauthorized', handleUnauthorized)
  }, [])

  const login = useCallback((token, userData) => {
    localStorage.setItem('grimoire_token', token)
    sessionStorage.removeItem('grimoire:suppress_oidc_autolaunch')
    setUser(userData)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(() => {
    // Clear the server-side session cookie so media/download GETs can no longer
    // authenticate. Best-effort — local state is cleared regardless.
    authApi.logout().catch(() => {})
    localStorage.removeItem('grimoire_token')
    // One-shot: prevents the OIDC auto-launch from immediately redirecting
    // the user back to the IdP after they explicitly logged out.
    sessionStorage.setItem('grimoire:suppress_oidc_autolaunch', '1')
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('grimoire_token')
    if (!token) return
    const userData = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null))
    if (userData) setUser(userData)
  }, [])

  return (
    <AuthContext.Provider value={{ status, user, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
