import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuCircleCheck, LuTriangleAlert } from 'react-icons/lu'
import api from '../../api'
import type { ApiError } from '../../api'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'

/** The kinds of record a cleanup can remove, in the order they are listed. */
const KINDS = ['books', 'maps', 'tokens', 'audio', 'models'] as const
type Kind = (typeof KINDS)[number]
type Counts = Partial<Record<Kind, number>>

interface Preview {
  missing: Counts
  total: Counts
  library_unavailable: boolean
}

type Outcome =
  | { kind: 'unavailable' }
  | { kind: 'clean' }
  | { kind: 'removed'; removed: Counts }
  | { kind: 'error'; message: string }

const count = (counts: Counts, kind: Kind): number => counts[kind] ?? 0
const sum = (counts: Counts): number => KINDS.reduce((n, k) => n + count(counts, k), 0)

/**
 * Removes the records whose files have gone from disk. It looks first and
 * shows what it found, and only removes once that list is confirmed - and not
 * at all when the library folder itself looks unmounted, since then every
 * record would look missing.
 */
export default function DatabaseCleanupSection() {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState<'checking' | 'removing' | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const describeFailure = (e: unknown): string => {
    const err = e as ApiError | undefined
    // 409: a scan is running or the library went away - the server says which.
    if (err?.status === 409 && err.message) return err.message
    if (!err?.status) return t('maintenance.cleanup.offline')
    return err.message
      ? t('maintenance.cleanup.failedWithReason', { message: err.message })
      : t('maintenance.cleanup.failed')
  }

  const findMissing = async () => {
    setBusy('checking')
    setOutcome(null)
    try {
      const data = (await api.get('/maintenance/cleanup-missing/preview')) as Preview
      if (data.library_unavailable) setOutcome({ kind: 'unavailable' })
      else if (sum(data.missing) === 0) setOutcome({ kind: 'clean' })
      else setPreview(data)
    } catch (e) {
      setOutcome({ kind: 'error', message: describeFailure(e) })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setPreview(null)
    setBusy('removing')
    try {
      const data = (await api.post('/maintenance/cleanup-missing')) as { removed: Counts }
      setOutcome({ kind: 'removed', removed: data.removed })
    } catch (e) {
      setOutcome({ kind: 'error', message: describeFailure(e) })
    } finally {
      setBusy(null)
    }
  }

  const number = (n: number) => n.toLocaleString(i18n.resolvedLanguage || i18n.language)
  const missingTotal = preview ? sum(preview.missing) : 0
  const removedTotal = outcome?.kind === 'removed' ? sum(outcome.removed) : 0
  // Every record of a kind missing at once is more often an unmounted folder
  // than a real clear-out, so say so before anything goes.
  const wholeKindMissing =
    preview !== null &&
    KINDS.some(
      (k) => count(preview.missing, k) > 0 && count(preview.missing, k) === count(preview.total, k)
    )

  return (
    <div>
      <h3 className="settings-section-title">{t('maintenance.cleanup.title')}</h3>
      <p className="settings-section-description">{t('maintenance.cleanup.description')}</p>

      <button
        type="button"
        onClick={() => void findMissing()}
        disabled={busy !== null}
        style={{
          ...dangerButton,
          opacity: busy ? 0.6 : 1,
          cursor: busy ? 'default' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!busy) e.currentTarget.style.background = dangerHover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = dangerButton.background as string
        }}
      >
        {busy ? <Spinner size={14} /> : <LuSearch size={14} aria-hidden="true" />}
        {busy === 'checking'
          ? t('maintenance.cleanup.checking')
          : busy === 'removing'
            ? t('maintenance.cleanup.cleaning')
            : t('maintenance.cleanup.find')}
      </button>

      <div role="status" style={{ marginTop: outcome && outcome.kind !== 'error' ? 20 : 0 }}>
        {outcome?.kind === 'clean' && (
          <div style={panel}>
            <LuCircleCheck size={18} color="var(--green)" style={icon} aria-hidden="true" />
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {t('maintenance.cleanup.allPresent')}
            </div>
          </div>
        )}
        {outcome?.kind === 'removed' && (
          <div style={panel}>
            <LuCircleCheck size={18} color="var(--green)" style={icon} aria-hidden="true" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                {removedTotal === 0
                  ? t('maintenance.cleanup.nothingToRemove')
                  : t('maintenance.cleanup.removed', { count: removedTotal })}
              </div>
              {removedTotal > 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px 16px',
                  }}
                >
                  {KINDS.filter((k) => count(outcome.removed, k) > 0).map((k) => (
                    <span key={k}>
                      {t(`maintenance.cleanup.${k}`, { count: count(outcome.removed, k) })}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {outcome?.kind === 'unavailable' && (
        <div role="alert" style={{ ...panel, marginTop: 20, borderColor: 'var(--warning)' }}>
          <LuTriangleAlert size={18} color="var(--warning)" style={icon} aria-hidden="true" />
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              {t('maintenance.cleanup.unavailableTitle')}
            </div>
            <div style={{ color: 'var(--text-dim)' }}>
              {t('maintenance.cleanup.unavailableBody')}
            </div>
          </div>
        </div>
      )}

      {outcome?.kind === 'error' && (
        <div
          role="alert"
          style={{ marginTop: 16, fontSize: 14, lineHeight: 1.5, color: 'var(--danger)' }}
        >
          {outcome.message}
        </div>
      )}

      {preview && (
        <ConfirmModal
          title={t('maintenance.cleanup.confirmTitle')}
          message={t('maintenance.cleanup.confirmMessage')}
          confirmLabel={t('maintenance.cleanup.confirmButton', { count: missingTotal })}
          onConfirm={() => void remove()}
          onClose={() => setPreview(null)}
        >
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
            {KINDS.filter((k) => count(preview.missing, k) > 0).map((k) => (
              <li key={k}>
                {t(`maintenance.cleanup.${k}`, { count: count(preview.missing, k) })}{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  {t('maintenance.cleanup.ofTotal', { total: number(count(preview.total, k)) })}
                </span>
              </li>
            ))}
          </ul>
          {wholeKindMissing && (
            <p
              style={{
                display: 'flex',
                gap: 8,
                margin: '14px 0 0',
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--warning)',
              }}
            >
              <LuTriangleAlert
                size={16}
                style={{ flexShrink: 0, marginTop: 2 }}
                aria-hidden="true"
              />
              {t('maintenance.cleanup.wholeKindWarning')}
            </p>
          )}
        </ConfirmModal>
      )}
    </div>
  )
}

const dangerButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '9px 18px',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
  border: '1px solid color-mix(in srgb, var(--danger) 50%, transparent)',
  color: 'var(--danger)',
  transition: 'background 0.15s',
}

const dangerHover = 'color-mix(in srgb, var(--danger) 25%, transparent)'

const panel: CSSProperties = {
  padding: '14px 18px',
  borderRadius: 8,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
}

const icon: CSSProperties = { flexShrink: 0, marginTop: 1 }
