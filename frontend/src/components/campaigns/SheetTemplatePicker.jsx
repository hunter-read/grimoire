import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuLibrary, LuFolder } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import { overlay, panel, closeBtn } from './sheetEditorStyles'

// Lets a member pick a blank form-fillable PDF (from the library Character
// Sheets category or a campaign file) to duplicate into their sheet slot.
export default function SheetTemplatePicker({ campaignId, memberId, onClose, onDuplicated }) {
  const { t } = useTranslation()
  const [sources, setSources] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    campaigns
      .listSheetSources(campaignId)
      .then(setSources)
      .catch((err) => {
        setError(err.message)
        setSources({ books: [], files: [] })
      })
  }, [campaignId])

  const duplicate = async (sourceType, sourceId) => {
    setBusy(true)
    setError(null)
    try {
      await campaigns.duplicateMemberSheet(campaignId, memberId, {
        source_type: sourceType,
        source_id: sourceId,
      })
      onDuplicated?.()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const renderGroup = (icon, label, items, sourceType) =>
    items.length > 0 && (
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-dim)',
            margin: '0 0 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {icon} {label}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => duplicate(sourceType, item.id)}
              disabled={busy}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-deep)',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
    )

  const isEmpty = sources && sources.books.length === 0 && sources.files.length === 0

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <button onClick={onClose} aria-label={t('common.close')} style={closeBtn}>
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
          {t('members.chooseTemplate')}
        </h3>

        {!sources ? (
          <Spinner size={18} />
        ) : isEmpty ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {t('members.noTemplates')}
          </p>
        ) : (
          <>
            {renderGroup(
              <LuLibrary size={13} />,
              t('members.librarySheets'),
              sources.books,
              'book'
            )}
            {renderGroup(
              <LuFolder size={13} />,
              t('members.campaignSheets'),
              sources.files,
              'file'
            )}
          </>
        )}

        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: '14px 0 0' }}>{error}</p>
        )}
      </div>
    </div>
  )
}
