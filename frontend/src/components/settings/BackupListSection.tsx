import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload, LuTrash2, LuTriangleAlert, LuDatabaseBackup } from 'react-icons/lu'
import { backups as backupsApi } from '../../api'
import Spinner from '../Spinner'
import { formatBytes, formatTimestamp, relativeAge } from './backupFormat'

export default function BackupListSection({ refreshKey }) {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState([])
  const [directory, setDirectory] = useState('')
  const [totalBytes, setTotalBytes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(null)

  // Deliberately dependency-free: `t` is a fresh identity on every render for
  // some i18n setups, and including it would rebuild `load`, re-fire the effect
  // below, and loop. The message is read when the error actually happens.
  const load = useCallback(async () => {
    try {
      const data = await backupsApi.list()
      setItems(data.backups || [])
      setDirectory(data.directory || '')
      setTotalBytes(data.total_bytes || 0)
      setError(null)
    } catch (e) {
      setError(e.message || 'Could not load backups.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      await backupsApi.create()
      await load()
    } catch (e) {
      setError(e.message || t('backups.list.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const handleDownload = async (item) => {
    setDownloading(item.id)
    setError(null)
    try {
      await backupsApi.download(item.id, item.filename)
    } catch (e) {
      setError(e.message || t('backups.list.downloadFailed'))
    } finally {
      setDownloading(null)
    }
  }

  const handleDelete = async (item) => {
    const when = formatTimestamp(item.created_at, i18n.language)
    if (!window.confirm(t('backups.list.confirmDelete', { date: when }))) return
    setError(null)
    try {
      await backupsApi.remove(item.id)
      await load()
    } catch (e) {
      setError(e.message || t('backups.list.deleteFailed'))
    }
  }

  const ageLabel = (iso) => {
    const age = relativeAge(iso)
    if (!age) return ''
    if (age.unit === 'justNow') return t('backups.list.age.justNow')
    return t(`backups.list.age.${age.unit}`, { count: age.count })
  }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{t('backups.list.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        {t('backups.list.description')}
      </p>

      {/* What a backup does NOT cover. Stated in the app, not only the docs, so
          nobody discovers the gap at restore time. */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '14px 16px',
          marginBottom: 20,
          borderRadius: 8,
          background: 'rgba(212,160,60,0.08)',
          border: '1px solid rgba(212,160,60,0.35)',
          alignItems: 'flex-start',
        }}
      >
        <LuTriangleAlert size={18} color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-dim)' }}>
          <strong style={{ color: 'var(--text)' }}>{t('backups.notice.title')}</strong>
          <div style={{ marginTop: 4 }}>{t('backups.notice.noLibrary')}</div>
          <div style={{ marginTop: 4 }}>{t('backups.notice.threeTwoOne')}</div>
          <div style={{ marginTop: 4 }}>{t('backups.notice.restore')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--gold-dim)',
            border: 'none',
            color: 'var(--bg-deep)',
            cursor: creating ? 'default' : 'pointer',
            opacity: creating ? 0.6 : 1,
          }}
        >
          {creating ? <Spinner size={14} /> : <LuDatabaseBackup size={14} />}
          {creating ? t('backups.list.creating') : t('backups.list.createButton')}
        </button>
        {creating && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('backups.list.blockingWarning')}
          </span>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 16, fontSize: 14, color: 'var(--danger)' }}>{error}</div>
      )}

      {loading ? (
        <Spinner size={20} />
      ) : items.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{t('backups.list.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {formatTimestamp(item.created_at, i18n.language)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {ageLabel(item.created_at)} · {formatBytes(item.size_bytes)} ·{' '}
                  {t('backups.list.version', { version: item.version })}
                </div>
              </div>
              <button
                onClick={() => handleDownload(item)}
                disabled={downloading === item.id}
                title={t('backups.list.download')}
                aria-label={t('backups.list.download')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  background: 'var(--bg-card-hover)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  cursor: downloading === item.id ? 'default' : 'pointer',
                }}
              >
                {downloading === item.id ? <Spinner size={12} /> : <LuDownload size={13} />}
                {t('backups.list.download')}
              </button>
              <button
                onClick={() => handleDelete(item)}
                title={t('backups.list.delete')}
                aria-label={t('backups.list.delete')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  background: 'rgba(180,60,60,0.15)',
                  border: '1px solid rgba(180,60,60,0.5)',
                  color: 'var(--danger)',
                  cursor: 'pointer',
                }}
              >
                <LuTrash2 size={13} />
                {t('backups.list.delete')}
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          {t('backups.list.summary', { count: items.length, size: formatBytes(totalBytes) })}
          <br />
          {t('backups.list.storedIn', { path: directory })}
        </div>
      )}
    </div>
  )
}
