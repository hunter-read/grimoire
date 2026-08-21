import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuSave, LuFileDown, LuTriangleAlert } from 'react-icons/lu'
import { sidecars as sidecarsApi } from '../../api'
import Spinner from '../Spinner'

// Mirrors backend.metadata.formats.ALL_FORMATS. Order is fixed so the list does
// not reshuffle between renders or saves.
const FORMATS = ['opf', 'nfo', 'json', 'yaml']

export default function SidecarExportSection() {
  const { t } = useTranslation()
  const [formats, setFormats] = useState([])
  const [covers, setCovers] = useState(false)
  const [overwriteForeign, setOverwriteForeign] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    sidecarsApi
      .get()
      .then((data) => {
        setFormats(data.formats || [])
        setCovers(data.covers ?? false)
        setOverwriteForeign(data.overwrite_foreign ?? false)
      })
      .catch(() => setError(t('maintenance.sidecars.loadFailed')))
      .finally(() => setLoading(false))
  }, [t])

  const toggleFormat = (fmt) => {
    setSaved(false)
    setFormats((current) =>
      current.includes(fmt) ? current.filter((f) => f !== fmt) : [...current, fmt]
    )
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const data = await sidecarsApi.save({
        formats,
        covers,
        overwrite_foreign: overwriteForeign,
      })
      setFormats(data.formats || [])
      setCovers(data.covers ?? false)
      setOverwriteForeign(data.overwrite_foreign ?? false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError(t('maintenance.sidecars.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setResult(null)
    setError(null)
    try {
      setResult(await sidecarsApi.export())
    } catch {
      setError(t('maintenance.sidecars.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  // The backfill writes whatever is saved on the server, not what is on screen,
  // so it stays disabled until at least one format has been saved.
  const enabled = formats.length > 0

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.sidecars.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.sidecars.description')}
      </p>

      {loading ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FORMATS.map((fmt) => (
              <label
                key={fmt}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--text)',
                  userSelect: 'none',
                }}
              >
                <input
                  id={`sidecar-format-${fmt}`}
                  type="checkbox"
                  checked={formats.includes(fmt)}
                  onChange={() => toggleFormat(fmt)}
                  style={{
                    width: 15,
                    height: 15,
                    cursor: 'pointer',
                    accentColor: 'var(--gold)',
                    marginTop: 2,
                    flexShrink: 0,
                  }}
                />
                <span>
                  <span style={{ fontWeight: 500 }}>
                    {t(`maintenance.sidecars.formats.${fmt}.label`)}
                  </span>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)' }}>
                    {t(`maintenance.sidecars.formats.${fmt}.hint`)}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
              fontSize: 14,
              color: 'var(--text)',
              userSelect: 'none',
            }}
          >
            <input
              id="sidecar-covers"
              type="checkbox"
              checked={covers}
              onChange={(e) => setCovers(e.target.checked)}
              style={{
                width: 15,
                height: 15,
                cursor: 'pointer',
                accentColor: 'var(--gold)',
                marginTop: 2,
                flexShrink: 0,
              }}
            />
            <span>
              {t('maintenance.sidecars.covers')}
              <span style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)' }}>
                {t('maintenance.sidecars.coversHint')}
              </span>
            </span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
              fontSize: 14,
              color: 'var(--text)',
              userSelect: 'none',
            }}
          >
            <input
              id="sidecar-overwrite"
              type="checkbox"
              checked={overwriteForeign}
              onChange={(e) => setOverwriteForeign(e.target.checked)}
              style={{
                width: 15,
                height: 15,
                cursor: 'pointer',
                accentColor: 'var(--gold)',
                marginTop: 2,
                flexShrink: 0,
              }}
            />
            <span>
              {t('maintenance.sidecars.overwriteForeign')}
              <span style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)' }}>
                {t('maintenance.sidecars.overwriteForeignHint')}
              </span>
            </span>
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                background: 'var(--gold-dim)',
                border: 'none',
                color: 'var(--bg-deep)',
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? <Spinner size={13} /> : <LuSave size={13} />}
              {saving ? t('maintenance.sidecars.saving') : t('maintenance.sidecars.save')}
            </button>

            <button
              onClick={handleExport}
              disabled={exporting || !enabled}
              title={enabled ? undefined : t('maintenance.sidecars.enableFirst')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: enabled ? 'var(--text)' : 'var(--text-muted)',
                cursor: exporting || !enabled ? 'default' : 'pointer',
                opacity: exporting ? 0.6 : 1,
              }}
            >
              {exporting ? <Spinner size={13} /> : <LuFileDown size={13} />}
              {exporting ? t('maintenance.sidecars.exporting') : t('maintenance.sidecars.export')}
            </button>

            {saved && (
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--green)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <LuCircleCheck size={14} /> {t('maintenance.sidecars.saved')}
              </span>
            )}
          </div>

          {result && (
            <div
              style={{
                padding: '14px 18px',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              {result.read_only ? (
                <LuTriangleAlert
                  size={18}
                  color="var(--danger)"
                  style={{ flexShrink: 0, marginTop: 1 }}
                />
              ) : (
                <LuCircleCheck
                  size={18}
                  color="var(--green)"
                  style={{ flexShrink: 0, marginTop: 1 }}
                />
              )}
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                  {t('maintenance.sidecars.written', { count: result.written })}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  {result.covers > 0 && (
                    <span>{t('maintenance.sidecars.coversWritten', { count: result.covers })}</span>
                  )}
                  {result.skipped_foreign > 0 && (
                    <span>
                      {t('maintenance.sidecars.skippedForeign', { count: result.skipped_foreign })}
                    </span>
                  )}
                  {result.failed > 0 && (
                    <span style={{ color: 'var(--danger)' }}>
                      {t('maintenance.sidecars.failed', { count: result.failed })}
                    </span>
                  )}
                </div>
                {result.errors?.length > 0 && (
                  <ul
                    style={{
                      margin: '8px 0 0',
                      paddingLeft: 18,
                      fontSize: 13,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {result.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {error && <div style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
