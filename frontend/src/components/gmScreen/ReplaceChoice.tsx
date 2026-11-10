import { useTranslation } from 'react-i18next'

interface ReplaceChoiceProps {
  replace: boolean
  onChange: (replace: boolean) => void
  /** Whether the board has panels to replace at all. */
  hasPanels: boolean
}

/** Whether a board coming in replaces this one or goes beneath it. */
export default function ReplaceChoice({ replace, onChange, hasPanels }: ReplaceChoiceProps) {
  const { t } = useTranslation()
  if (!hasPanels) return null
  return (
    <fieldset
      style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 13 }}
    >
      <legend style={{ fontWeight: 600, marginBottom: 4 }}>
        {t('gmScreen.board.whereLegend')}
      </legend>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={replace} onChange={() => onChange(true)} />
        {t('gmScreen.board.replace')}
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="radio" checked={!replace} onChange={() => onChange(false)} />
        {t('gmScreen.board.append')}
      </label>
    </fieldset>
  )
}
