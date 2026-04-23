import { createContext, useContext, useState, useEffect, useCallback } from 'react'

// status: 'loading' | 'uninitialized' | 'unauthenticated' | 'authenticated'
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('grimoire_token')

    fetch('/api/auth/status')
      .then((r) => r.json())
      .then(({ initialized }) => {
        if (!initialized) {
          setStatus('uninitialized')
          return
        }
        if (!token) {
          setStatus('unauthenticated')
          return
        }
        // Validate existing token
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((userData) => {
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
    setUser(userData)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('grimoire_token')
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
