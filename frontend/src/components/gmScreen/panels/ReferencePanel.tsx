import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { referenceConfig } from '../types'
import type { PanelBodyProps } from './panelProps'
import ReferenceMarkdown from './ReferenceMarkdown'

const chip = (active: boolean) => ({
  padding: '3px 9px',
  fontSize: 12,
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--on-accent)' : 'inherit',
  cursor: 'pointer',
})

/**
 * Rules to look up mid-session - the conditions, setting a DC, cover - in
 * sections the GM switches between. Read-only on the board; the text is set in
 * the panel's settings or comes with a preset. Which section is open is this
 * browser's own business, so switching saves nothing.
 */
export default function ReferencePanel({ panel }: PanelBodyProps) {
  const { t } = useTranslation()
  const { sections } = referenceConfig(panel.config)
  const [openId, setOpenId] = useState<string | null>(null)

  if (sections.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('gmScreen.reference.empty')}
      </p>
    )
  }
  const open = sections.find((section) => section.id === openId) ?? sections[0]
  const titleOf = (index: number) =>
    sections[index].title || t('gmScreen.reference.untitled', { number: index + 1 })

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {sections.length > 1 && (
        <div
          role="group"
          aria-label={t('gmScreen.reference.sections')}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
        >
          {sections.map((section, index) => (
            <button
              key={section.id}
              type="button"
              aria-pressed={section.id === open.id}
              onClick={() => setOpenId(section.id)}
              style={chip(section.id === open.id)}
            >
              {titleOf(index)}
            </button>
          ))}
        </div>
      )}
      <section aria-label={titleOf(sections.indexOf(open))}>
        {sections.length === 1 && open.title && (
          <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>{open.title}</h3>
        )}
        <ReferenceMarkdown text={open.text} />
      </section>
    </div>
  )
}
