import { useTranslation } from 'react-i18next'
import { LuFilePlus, LuDownload, LuTrash2, LuPencil } from 'react-icons/lu'
import Spinner from '../Spinner'
import {
  groupHeading,
  row,
  rowMain,
  rowDesc,
  systemTag,
  iconBtn,
  emptyText,
} from './wikiTemplateStyles'

// The campaign's own templates — the list a GM starts pages from. Grouped by
// category so a long list stays scannable.
export default function WikiTemplateList({ templates, busyId, onUse, onDelete, onExport, onEdit }) {
  const { t } = useTranslation()

  if (templates === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
        <Spinner size={22} />
      </div>
    )
  }
  if (templates.length === 0) {
    return <p style={emptyText}>{t('wiki.templatesNone')}</p>
  }

  const groups = new Map()
  for (const tpl of templates) {
    const key = tpl.category || 'General'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(tpl)
  }

  return (
    <>
      {[...groups.entries()].map(([category, items]) => (
        <div key={category} style={{ marginBottom: 16 }}>
          <div style={groupHeading}>{category}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((tpl) => (
              <div key={tpl.id} style={row}>
                <LuFilePlus size={15} style={{ flexShrink: 0, color: 'var(--gold)' }} />
                <button
                  onClick={() => onUse(tpl.id)}
                  disabled={busyId !== null}
                  title={t('wiki.templateUse')}
                  style={rowMain(busyId !== null)}
                >
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                    {tpl.name}
                    {tpl.system && <span style={systemTag}>{tpl.system}</span>}
                  </span>
                  {tpl.description && <span style={rowDesc}>{tpl.description}</span>}
                </button>
                <button
                  onClick={() => onEdit(tpl)}
                  aria-label={`${t('common.edit')} ${tpl.name}`}
                  style={iconBtn}
                >
                  <LuPencil size={13} />
                </button>
                <button
                  onClick={() => onExport(tpl)}
                  aria-label={`${t('wiki.templateExport')} ${tpl.name}`}
                  title={t('wiki.templateExport')}
                  style={iconBtn}
                >
                  <LuDownload size={13} />
                </button>
                <button
                  onClick={() => onDelete(tpl)}
                  aria-label={`${t('common.delete')} ${tpl.name}`}
                  style={{ ...iconBtn, color: 'var(--danger)' }}
                >
                  <LuTrash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
