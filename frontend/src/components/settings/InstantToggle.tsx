import { useId } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import Spinner from '../Spinner'

interface InstantToggleProps {
  id: string
  label: ReactNode
  checked: boolean
  onChange: () => void
  disabled?: boolean
  /** Pinned by the server (an environment variable): shown greyed, not just off. */
  locked?: boolean
  saving?: boolean
  saved?: boolean
  /** Why the last change didn't save; the box has already been put back. */
  error?: string | null
  /** Notes under the row (an env-lock notice, a hint). */
  children?: ReactNode
}

/**
 * A checkbox that saves as soon as it changes, with its outcome beside it:
 * a spinner while saving, then "Saved" in a live region so a screen reader
 * hears it too, or the server's reason when it didn't take.
 */
export default function InstantToggle({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  locked = false,
  saving = false,
  saved = false,
  error = null,
  children,
}: InstantToggleProps) {
  const { t } = useTranslation()
  const errorId = useId()
  const off = disabled || locked || saving
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px' }}>
        <label
          htmlFor={id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: off ? 'not-allowed' : 'pointer',
            opacity: locked || disabled ? 0.7 : 1,
          }}
        >
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={off}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            style={{
              width: 16,
              height: 16,
              flexShrink: 0,
              cursor: off ? 'not-allowed' : 'pointer',
              accentColor: 'var(--gold)',
            }}
          />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>{label}</span>
        </label>
        {saving && <Spinner size={13} />}
        <span
          role="status"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--green)',
          }}
        >
          {saved && (
            <>
              <LuCircleCheck size={14} aria-hidden="true" />
              {t('common.saved')}
            </>
          )}
        </span>
      </div>
      {error && (
        <div
          id={errorId}
          role="alert"
          style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
      {children}
    </div>
  )
}
