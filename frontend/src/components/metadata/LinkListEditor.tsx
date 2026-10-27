import { useTranslation } from 'react-i18next'
import { LuX, LuPlus } from 'react-icons/lu'
import type { LinkRow } from './metadataUtils'

/**
 * Repeatable list of labeled links ([{ label, url }]). Used for a system's
 * generic URLs and character-builder URLs, and a book's URLs. Empty rows are
 * filtered out by the caller on save (see cleanLinks).
 */
export type EditableLink = LinkRow

export interface LinkListEditorProps {
  links: EditableLink[]
  onChange: (links: EditableLink[]) => void
  addLabel: string
  labelPlaceholder?: string
  urlPlaceholder?: string
  idPrefix?: string
}

export default function LinkListEditor({
  links,
  onChange,
  addLabel,
  labelPlaceholder,
  urlPlaceholder,
  idPrefix = 'link',
}: LinkListEditorProps) {
  const { t } = useTranslation()
  const setLink = (idx: number, key: keyof EditableLink, value: string) =>
    onChange(links.map((l, i) => (i === idx ? { ...l, [key]: value } : l)))

  const addLink = () => onChange([...links, { label: '', url: '' }])
  const removeLink = (idx: number) => onChange(links.filter((_, i) => i !== idx))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {links.map((l, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            id={`${idPrefix}-label-${idx}`}
            type="text"
            value={l.label}
            onChange={(e) => setLink(idx, 'label', e.target.value)}
            placeholder={labelPlaceholder}
            aria-label={labelPlaceholder}
            style={{ flex: '1 1 130px', minWidth: 0 }}
          />
          <input
            id={`${idPrefix}-url-${idx}`}
            type="text"
            value={l.url}
            onChange={(e) => setLink(idx, 'url', e.target.value)}
            placeholder={urlPlaceholder}
            aria-label={urlPlaceholder}
            style={{ flex: '1 1 180px', minWidth: 0 }}
          />
          <button
            type="button"
            onClick={() => removeLink(idx)}
            aria-label={t('common.removeLink')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 4,
            }}
          >
            <LuX size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addLink}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: 13,
          padding: '2px 0',
        }}
      >
        <LuPlus size={13} /> {addLabel}
      </button>
    </div>
  )
}
