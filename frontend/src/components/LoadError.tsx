import { useTranslation } from 'react-i18next'

export interface LoadErrorProps {
  /** The request failed with a 404: say the item is gone rather than broken. */
  notFound?: boolean
  /** Shown in place of the generic message, when the caller has a better one. */
  message?: string
  /** Offers "Try again" when given. */
  onRetry?: () => void
}

/**
 * In place of a page or panel whose data could not be fetched, so a failed
 * request reads as a failure rather than a spinner that never ends.
 */
export default function LoadError({ notFound, message, onRetry }: LoadErrorProps) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      style={{
        padding: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <p style={{ margin: 0 }}>
        {message || (notFound ? t('common.notFound') : t('common.loadFailed'))}
      </p>
      {onRetry && !notFound && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 13,
            background: 'var(--bg-card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          {t('common.tryAgain')}
        </button>
      )}
    </div>
  )
}
