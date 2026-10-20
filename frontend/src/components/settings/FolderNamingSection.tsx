import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { naming, type Schema } from '../../api'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'
import FolderNamingDialog from './FolderNamingDialog'
import { badgeStyle, buttonStyle, failure, hintStyle, iconButtonStyle } from './filenameRulesStyles'

type Rule = Schema<'FolderRuleOut'>
type Rules = Schema<'FolderRulesResponse'>

/**
 * Every books folder with a naming pattern (issues #521 and #522).
 *
 * The list is the overview; everything that changes a book happens in the
 * dialog, which previews before it applies.
 */
export default function FolderNamingSection() {
  const { t } = useTranslation()
  const [data, setData] = useState<Rules | null>(null)
  const [error, setError] = useState('')
  // `null` = closed; `{}` = a new rule; `{ rule }` = editing that one.
  const [editing, setEditing] = useState<{ rule?: Rule } | null>(null)
  const [removing, setRemoving] = useState<Rule | null>(null)

  const load = useCallback(() => {
    naming
      .folders()
      .then((body) => {
        setData(body)
        setError('')
      })
      .catch((err: unknown) => setError(failure(err) || t('filenameRules.folders.loadFailed')))
  }, [t])

  useEffect(load, [load])

  const remove = async () => {
    const rule = removing
    setRemoving(null)
    if (!rule) return
    try {
      await naming.deleteFolder(rule.path)
      load()
    } catch (err) {
      setError(failure(err) || t('filenameRules.folders.removeFailed'))
    }
  }

  if (!data && !error) return <Spinner size={20} />

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button type="button" onClick={() => setEditing({})} style={buttonStyle(true)}>
          <LuPlus size={13} /> {t('filenameRules.folders.add')}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {data && data.rules.length === 0 && (
        <p style={hintStyle}>{t('filenameRules.folders.empty')}</p>
      )}

      {data && data.rules.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {data.rules.map((rule) => (
            <li
              key={rule.path}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>
                  {rule.path}
                </div>
                <code
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    marginTop: 2,
                    wordBreak: 'break-word',
                  }}
                >
                  {rule.pattern}
                </code>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {!rule.renderable && !rule.error && (
                    <span
                      style={badgeStyle('muted')}
                      title={t('filenameRules.folders.readOnlyHint')}
                    >
                      {t('filenameRules.folders.readOnly')}
                    </span>
                  )}
                  {!rule.exists && (
                    <span style={badgeStyle('warn')}>{t('filenameRules.folders.missing')}</span>
                  )}
                  {rule.error && (
                    <span style={badgeStyle('danger')}>
                      {t('filenameRules.folders.broken', { error: rule.error })}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing({ rule })}
                aria-label={t('filenameRules.folders.editLabel', { path: rule.path })}
                style={iconButtonStyle}
              >
                <LuPencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => setRemoving(rule)}
                aria-label={t('filenameRules.folders.removeLabel', { path: rule.path })}
                style={iconButtonStyle}
              >
                <LuTrash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <FolderNamingDialog
          rule={editing.rule}
          fields={data?.fields ?? []}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {removing && (
        <ConfirmModal
          title={t('filenameRules.folders.removeTitle')}
          message={t('filenameRules.folders.removeConfirm', { path: removing.path })}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
