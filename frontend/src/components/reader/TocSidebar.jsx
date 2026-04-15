import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuList, LuX, LuChevronDown } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

function TocEntry({ node, currentPage, onGoToPage, depth = 0 }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0
  const isActive = currentPage === node.page

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          paddingLeft: 8 + depth * 14, paddingRight: 8,
          paddingTop: 4, paddingBottom: 4,
          background: isActive ? 'var(--bg-card-hover)' : 'none',
          borderRadius: 4,
        }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-label={open ? t('toc.collapse', { title: node.title }) : t('toc.expand', { title: node.title })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0, padding: 0 }}
          >
            <LuChevronDown size={12} aria-hidden="true" style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
          </button>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        <button
          onClick={() => onGoToPage(node.page)}
          style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            color: isActive ? 'var(--gold)' : 'var(--text-dim)',
            fontSize: depth === 0 ? 13 : 12,
            fontWeight: depth === 0 ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: 0,
          }}
          title={node.title}
        >
          {node.title}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{node.page}</span>
      </div>
      {hasChildren && open && node.children.map((child, i) => (
        <TocEntry key={i} node={child} currentPage={currentPage} onGoToPage={onGoToPage} depth={depth + 1} />
      ))}
    </div>
  )
}

export default function TocSidebar({ bookId, currentPage, onGoToPage, onClose }) {
  const { t } = useTranslation()
  const [toc, setToc] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/books/${bookId}/toc`)
      .then(r => { setToc(r.toc); setLoading(false) })
      .catch(() => { setToc([]); setLoading(false) })
  }, [bookId])

  return (
    <div style={{
      width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)',
      background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <LuList size={14} color="var(--text-muted)" aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>{t('toc.sidebarTitle')}</span>
        <button onClick={onClose} aria-label={t('toc.closeToc')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
          <LuX size={15} aria-hidden="true" />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
        {loading && <div style={{ padding: 20, textAlign: 'center' }}><Spinner size={20} /></div>}
        {!loading && toc && toc.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {t('toc.noToc')}
          </div>
        )}
        {!loading && toc && toc.map((node, i) => (
          <TocEntry key={i} node={node} currentPage={currentPage} onGoToPage={onGoToPage} depth={0} />
        ))}
      </div>
    </div>
  )
}
