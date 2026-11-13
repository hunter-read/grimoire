import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { fieldInput, ghostBtn, iconBtn } from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'
import { referenceConfig, rowId, type ReferenceSection } from '../types'

const MAX_SECTIONS = 30

/** The reference's sections: a title for its button, and Markdown to show. */
export default function ReferenceSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  const { sections } = referenceConfig(config)
  const save = (next: ReferenceSection[]) => onChange({ ...config, sections: next })
  const update = (id: string, patch: Partial<ReferenceSection>) =>
    save(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)))

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        {t('gmScreen.reference.help')}
      </p>
      {sections.map((section, index) => (
        <fieldset
          key={section.id}
          style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={section.title}
              maxLength={60}
              aria-label={t('gmScreen.reference.sectionTitle', { number: index + 1 })}
              placeholder={t('gmScreen.reference.untitled', { number: index + 1 })}
              onChange={(event) => update(section.id, { title: event.target.value })}
              style={{ ...fieldInput, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => save(sections.filter((other) => other.id !== section.id))}
              aria-label={t('gmScreen.reference.removeSection', { number: index + 1 })}
              style={iconBtn}
            >
              <LuTrash2 size={14} aria-hidden="true" />
            </button>
          </div>
          <textarea
            value={section.text}
            maxLength={8000}
            rows={6}
            aria-label={t('gmScreen.reference.sectionText', { number: index + 1 })}
            onChange={(event) => update(section.id, { text: event.target.value })}
            style={{ ...fieldInput, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
        </fieldset>
      ))}
      {sections.length < MAX_SECTIONS && (
        <button
          type="button"
          onClick={() => save([...sections, { id: rowId(), title: '', text: '' }])}
          style={{ ...ghostBtn, justifySelf: 'start', padding: '5px 10px' }}
        >
          <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.reference.addSection')}
        </button>
      )}
    </div>
  )
}
