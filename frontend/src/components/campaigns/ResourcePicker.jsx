import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBookOpen, LuSearch, LuX } from 'react-icons/lu'
import { campaigns, mediaUrl } from '../../api'
import Spinner from '../Spinner'
import { TYPE_ICONS } from './resourcesShared'
import LazyImg from '../LazyImg'

/** Search-and-link picker for adding library resources to a campaign. */
export default function ResourcePicker({ campaignId, linkedIds, onAdd, onClose }) {
  const { t } = useTranslation()
  const TYPE_TABS = [
    { key: '', label: t('resources.all') },
    { key: 'book', label: t('resources.books') },
    { key: 'map', label: t('resources.maps') },
    { key: 'token', label: t('resources.tokens') },
  ]
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const searchRef = useRef(null)
  const debounce = useRef(null)

  const doSearch = (q, type) => {
    setLoading(true)
    campaigns
      .searchResources(q, type)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    searchRef.current?.focus()
    doSearch('', '')
  }, [])

  const handleQuery = (v) => {
    setQuery(v)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => doSearch(v, typeFilter), 250)
  }

  const handleType = (tp) => {
    setTypeFilter(tp)
    doSearch(query, tp)
  }

  const handleAdd = async (item) => {
    try {
      await campaigns.addResource(campaignId, {
        resource_type: item.resource_type,
        resource_id: item.resource_id,
        visibility: 'public',
      })
      onAdd()
    } catch (err) {
      if (err.status === 409) return
      alert(err.message)
    }
  }

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-light)',
        borderRadius: 12,
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t('resources.linkTitle')}</div>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: 2,
          }}
        >
          <LuX size={16} aria-hidden="true" />
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 10,
          background: 'var(--bg-deep)',
          borderRadius: 8,
          padding: 4,
        }}
      >
        {TYPE_TABS.map((tp) => (
          <button
            key={tp.key}
            onClick={() => handleType(tp.key)}
            style={{
              flex: 1,
              padding: '5px 0',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              border: 'none',
              background: typeFilter === tp.key ? 'var(--bg-card)' : 'transparent',
              color: typeFilter === tp.key ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {tp.label}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <LuSearch
          size={14}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => handleQuery(e.target.value)}
          aria-label={t('resources.searchAriaLabel')}
          placeholder={t('resources.searchPlaceholder')}
          style={{
            width: '100%',
            padding: '8px 10px 8px 32px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            fontSize: 13,
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div
        style={{
          maxHeight: 260,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <Spinner size={18} />
          </div>
        )}
        {!loading && results.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '16px 0',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            {t('resources.noResults')}
          </div>
        )}
        {!loading &&
          results.map((item) => {
            const key = `${item.resource_type}:${item.resource_id}`
            const alreadyLinked = linkedIds.has(key)
            const { Icon, color } = TYPE_ICONS[item.resource_type] || {
              Icon: LuBookOpen,
              color: 'var(--text-muted)',
            }
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  background: alreadyLinked ? 'var(--bg-deep)' : 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  opacity: alreadyLinked ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 32,
                    borderRadius: 4,
                    background: 'var(--bg-deep)',
                    border: '1px solid var(--border)',
                    flexShrink: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.has_thumbnail ? (
                    <LazyImg
                      src={mediaUrl(
                        `/${item.resource_type === 'book' ? 'books' : item.resource_type + 's'}/${item.resource_id}/thumbnail`
                      )}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Icon size={12} color={color} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </div>
                  {item.subtitle && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.subtitle}</div>
                  )}
                </div>
                <button
                  onClick={() => !alreadyLinked && handleAdd(item)}
                  disabled={alreadyLinked}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: 'none',
                    cursor: alreadyLinked ? 'default' : 'pointer',
                    background: alreadyLinked ? 'var(--bg-deep)' : 'var(--gold)',
                    color: alreadyLinked ? 'var(--text-muted)' : '#1a1209',
                    fontSize: 12,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {alreadyLinked ? t('resources.linked') : t('resources.addResource')}
                </button>
              </div>
            )
          })}
      </div>
    </div>
  )
}
