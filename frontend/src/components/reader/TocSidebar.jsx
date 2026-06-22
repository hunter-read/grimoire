import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuList, LuX, LuChevronDown } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import TocEntry from './TocEntry'

export default function TocSidebar({ bookId, currentPage, onGoToPage, onClose }) {
  const { t } = useTranslation()
  const [toc, setToc] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get(`/books/${bookId}/toc`)
      .then((r) => {
        setToc(r.toc)
        setLoading(false)
      })
      .catch(() => {
        setToc([])
        setLoading(false)
      })
  }, [bookId])

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <LuList size={14} color="var(--text-muted)" aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>
          {t('toc.sidebarTitle')}
        </span>
        <button
          onClick={onClose}
          aria-label={t('toc.closeToc')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
          }}
        >
          <LuX size={15} aria-hidden="true" />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
        {loading && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Spinner size={20} />
          </div>
        )}
        {!loading && toc && toc.length === 0 && (
          <div
            style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
          >
            {t('toc.noToc')}
          </div>
        )}
        {!loading &&
          toc &&
          toc.map((node, i) => (
            <TocEntry
              key={i}
              node={node}
              currentPage={currentPage}
              onGoToPage={onGoToPage}
              depth={0}
            />
          ))}
      </div>
    </div>
  )
}
