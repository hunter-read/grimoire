import { useTranslation } from 'react-i18next'
import { LuX, LuRotateCw, LuCircleCheck, LuTriangleAlert } from 'react-icons/lu'
import Spinner from '../Spinner'

function formatSize(bytes) {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/**
 * Live status for an upload batch: one row per file, with progress and retry.
 *
 * Shown for the whole batch rather than as a transient toast, because the case
 * that matters is a large import where a few files fail — a toast would report
 * "3 failed" and leave the user with no idea which three, or any way to act on
 * it. Every failure names its file and its reason, and can be retried on its own.
 */
export default function UploadPanel({ queue, onClose }) {
  const { t } = useTranslation()
  const { items, counts, inFlight } = queue

  if (!items.length) return null

  const failed = items.filter((it) => it.status === 'error' || it.status === 'cancelled')

  return (
    <div
      data-testid="upload-panel"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-panel)',
        marginBottom: 12,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: 13,
        }}
      >
        {inFlight > 0 ? <Spinner size={14} /> : <LuCircleCheck size={14} />}
        <strong style={{ fontWeight: 600 }}>
          {inFlight > 0
            ? t('files.uploadingCount', { done: counts.done, total: items.length })
            : t('files.uploadFinished', { done: counts.done, total: items.length })}
        </strong>
        {counts.error > 0 && (
          <span style={{ color: 'var(--danger)' }}>
            {t('files.uploadFailedCount', { count: counts.error })}
          </span>
        )}

        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          {failed.length > 0 && (
            <button onClick={queue.retryFailed} style={ghost} data-testid="retry-all">
              <LuRotateCw size={12} /> {t('files.retryFailed')}
            </button>
          )}
          {inFlight > 0 && (
            <button onClick={queue.cancelAll} style={ghost} data-testid="cancel-all">
              {t('files.cancelAll')}
            </button>
          )}
          {counts.done > 0 && (
            <button onClick={queue.clearCompleted} style={ghost}>
              {t('files.clearCompleted')}
            </button>
          )}
          {inFlight === 0 && (
            <button onClick={onClose} style={ghost} aria-label={t('common.close')}>
              <LuX size={13} />
            </button>
          )}
        </span>
      </div>

      <div style={{ maxHeight: 190, overflowY: 'auto' }}>
        {items.map((it) => (
          <div
            key={it.id}
            data-testid={`upload-${it.name}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '5px 12px',
              fontSize: 12,
              borderBottom: '1px solid var(--border-light)',
            }}
          >
            <span style={{ width: 16, display: 'flex', flexShrink: 0 }}>
              {it.status === 'uploading' && <Spinner size={11} />}
              {it.status === 'done' && <LuCircleCheck size={12} color="var(--success)" />}
              {it.status === 'error' && <LuTriangleAlert size={12} color="var(--danger)" />}
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: it.status === 'error' ? 'var(--danger)' : 'var(--text)',
              }}
              title={it.relativeDir ? `${it.relativeDir}/${it.name}` : it.name}
            >
              {it.relativeDir ? `${it.relativeDir}/${it.name}` : it.name}
            </span>

            {/* The reason a file failed, inline — a count alone gives the user
                nothing to act on. */}
            {it.error && <span style={{ color: 'var(--danger)', flexShrink: 0 }}>{it.error}</span>}

            {it.status === 'uploading' && (
              <span
                style={{
                  width: 90,
                  height: 4,
                  borderRadius: 2,
                  background: 'var(--bg-card)',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                <span
                  data-testid={`progress-${it.name}`}
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${Math.round(it.progress * 100)}%`,
                    background: 'var(--gold)',
                  }}
                />
              </span>
            )}

            <span style={{ color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {formatSize(it.size)}
            </span>

            {(it.status === 'error' || it.status === 'cancelled') && (
              <button
                onClick={() => queue.retry([it.id])}
                style={ghost}
                data-testid={`retry-${it.name}`}
                title={t('files.retry')}
              >
                <LuRotateCw size={11} />
              </button>
            )}
            {(it.status === 'uploading' || it.status === 'queued') && (
              <button
                onClick={() => queue.cancel(it.id)}
                style={ghost}
                title={t('common.cancel')}
                data-testid={`cancel-${it.name}`}
              >
                <LuX size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const ghost = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 5,
  fontSize: 11,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}
