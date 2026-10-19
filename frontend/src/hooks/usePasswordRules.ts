import { useEffect, useState } from 'react'
import { auth, type Schema } from '../api'

/**
 * The shortest passwords the server accepts. Password rules are configurable
 * per instance (PASSWORD_MIN_LENGTH, SHARE_LINK_PASSWORD_MIN_LENGTH), so the
 * forms read them from GET /api/auth/status instead of assuming a number.
 */
export interface PasswordRules {
  /** Minimum length of an account password. */
  passwordMinLength: number
  /** Minimum length of a share-link password. */
  shareLinkPasswordMinLength: number
}

/** The server's defaults: shown until the status arrives, and kept if it can't be read. */
export const DEFAULT_PASSWORD_RULES: Readonly<PasswordRules> = Object.freeze({
  passwordMinLength: 12,
  shareLinkPasswordMinLength: 8,
})

type AuthStatus = Schema<'AuthStatusResponse'>

// One answer per page load. AuthProvider already fetches /api/auth/status at
// start-up and hands the response over (rememberAuthStatus), so the forms
// normally never ask; `pending` covers a form that mounts without it.
let settled: PasswordRules | null = null
let pending: Promise<PasswordRules> | null = null

const minimum = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

function rulesFrom(status: Partial<AuthStatus>): PasswordRules {
  return {
    passwordMinLength: minimum(
      status.password_min_length,
      DEFAULT_PASSWORD_RULES.passwordMinLength
    ),
    shareLinkPasswordMinLength: minimum(
      status.share_link_password_min_length,
      DEFAULT_PASSWORD_RULES.shareLinkPasswordMinLength
    ),
  }
}

/** Keep the rules from an /api/auth/status response fetched elsewhere. */
export function rememberAuthStatus(status: Partial<AuthStatus> | null | undefined): void {
  if (status && typeof status === 'object') settled = rulesFrom(status)
}

/** Forget the rules, so the next form asks the server again (used by tests). */
export function clearPasswordRulesCache(): void {
  settled = null
  pending = null
}

function load(): Promise<PasswordRules> {
  if (settled) return Promise.resolve(settled)
  if (!pending) {
    pending = Promise.resolve()
      // Called inside the chain, so an API that is missing (a partial test mock)
      // rejects like a failed request and the defaults stay.
      .then(() => auth.status())
      .then((status) => {
        if (!status || typeof status !== 'object') throw new Error('No auth status')
        settled = rulesFrom(status)
        return settled
      })
      .catch((err: unknown) => {
        // Let the next form that mounts try again.
        pending = null
        throw err
      })
  }
  return pending
}

/** The server's password minimums, falling back to the defaults until they load. */
export default function usePasswordRules(): PasswordRules {
  const [rules, setRules] = useState<PasswordRules>(settled ?? DEFAULT_PASSWORD_RULES)

  useEffect(() => {
    let active = true
    load()
      .then((loaded) => {
        if (active) setRules(loaded)
      })
      .catch(() => {
        // Keep the defaults; the server still checks every password it is sent.
      })
    return () => {
      active = false
    }
  }, [])

  return rules
}
