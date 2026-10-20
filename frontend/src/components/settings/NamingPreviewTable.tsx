import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import NamingFilenameCell from './NamingFilenameCell'
import NamingTitleCell from './NamingTitleCell'
import { hintStyle } from './filenameRulesStyles'
import { isActionable } from './namingPreview'

type Preview = Schema<'PreviewResponse'>

interface Props {
  preview: Preview
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (on: boolean) => void
}

const cell: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  fontSize: 12,
  lineHeight: 1.45,
  wordBreak: 'break-word',
}

const head: CSSProperties = {
  ...cell,
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-dim)',
  position: 'sticky',
  top: 0,
  background: 'var(--bg-panel)',
}

/**
 * The books a naming pattern governs, with what each action would do to them.
 *
 * One selection serves both actions: "update titles" touches the selected rows
 * whose title would change, "rename files" the selected rows that can be
 * renamed. A row neither applies to cannot be selected, so a count on a button
 * is always the number of books it will actually change.
 */
export default function NamingPreviewTable({ preview, selected, onToggle, onToggleAll }: Props) {
  const { t } = useTranslation()
  const actionable = preview.rows.filter(isActionable)
  const allOn = actionable.length > 0 && actionable.every((r) => selected.has(r.id))

  if (preview.rows.length === 0) {
    return <p style={hintStyle}>{t('filenameRules.preview.empty')}</p>
  }

  return (
    <div>
      <div style={{ ...hintStyle, marginBottom: 6 }}>
        {t('filenameRules.preview.summary', { count: preview.total })}
        {preview.truncated &&
          ` ${t('filenameRules.preview.truncated', { shown: preview.rows.length, total: preview.total })}`}
      </div>
      <div
        style={{
          maxHeight: 360,
          overflow: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ ...head, width: 28 }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  disabled={actionable.length === 0}
                  onChange={() => onToggleAll(!allOn)}
                  aria-label={t('filenameRules.preview.selectAll')}
                />
              </th>
              <th style={head}>{t('filenameRules.preview.colFile')}</th>
              <th style={head}>{t('filenameRules.preview.colTitle')}</th>
              {preview.renderable && <th style={head}>{t('filenameRules.preview.colFilename')}</th>}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.id}>
                <td style={cell}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    disabled={!isActionable(row)}
                    onChange={() => onToggle(row.id)}
                    aria-label={t('filenameRules.preview.selectRow', { name: row.filename })}
                  />
                </td>
                <td style={{ ...cell, color: 'var(--text-dim)' }}>{row.filename}</td>
                <td style={cell}>
                  <NamingTitleCell row={row} />
                </td>
                {preview.renderable && (
                  <td style={cell}>
                    <NamingFilenameCell row={row} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
