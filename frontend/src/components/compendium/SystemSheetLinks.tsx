import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuUserPlus } from 'react-icons/lu'
import type { Schema } from '../../api'

export interface SystemSheetLinksProps {
  sheets: Schema<'CompendiumSheet'>[]
}

/**
 * The character sheets a system is set up with, as "new character" shortcuts.
 *
 * A sheet the reader has - their own copy, or one installed for everyone -
 * opens the new-character dialog on it. One they do not have is named all the
 * same, so a player knows which sheet to install.
 */
export default function SystemSheetLinks({ sheets }: SystemSheetLinksProps) {
  const { t } = useTranslation()
  if (!sheets.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{t('compendium.characterSheets')}:</span>
      {sheets.map((sheet) =>
        sheet.available ? (
          <Link
            key={sheet.schema_id}
            to={`/characters?new=${encodeURIComponent(sheet.schema_id)}`}
            title={t('compendium.newCharacterOn', { name: sheet.name })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-dim)',
              textDecoration: 'none',
            }}
          >
            <LuUserPlus size={12} aria-hidden="true" />
            {sheet.name}
          </Link>
        ) : (
          <span
            key={sheet.schema_id}
            title={t('compendium.sheetNotInstalled')}
            style={{ color: 'var(--text-muted)' }}
          >
            {sheet.name}
          </span>
        )
      )}
    </div>
  )
}
