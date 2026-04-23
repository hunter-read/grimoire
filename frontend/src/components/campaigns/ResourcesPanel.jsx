import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  LuBookOpen,
  LuMap,
  LuUser,
  LuPlus,
  LuTrash2,
  LuEye,
  LuEyeOff,
  LuSearch,
  LuX,
  LuChevronRight,
} from 'react-icons/lu'
import { campaigns, mediaUrl } from '../../api'
import Spinner from '../Spinner'

const TYPE_ICONS = {
  book: { Icon: LuBookOpen, color: '#a78bfa' },
  map: { Icon: LuMap, color: '#60a5fa' },
  token: { Icon: LuUser, color: '#34d399' },
}

const RESOURCE_NAV = {
  book: (id) => `/library/book/${id}`,
  map: (id) => `/maps/${id}`,
  token: (id) => `/tokens/${id}`,
}

function ResourceRow({ resource, isOwner, isGmCampaign, onRemove, onToggleShare }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const { Icon } = TYPE_ICONS[resource.resource_type] || { Icon: LuBookOpen }

  const isBook = resource.resource_type === 'book'
  const thumbUrl = resource.has_thumbnail
    ? mediaUrl(
        `/${isBook ? 'books' : resource.resource_type + 's'}/${resource.resource_id}/thumbnail`
      )
    : null

  const handleNav = () =>
    navigate(RESOURCE_NAV[resource.resource_type]?.(resource.resource_id) ?? '/')

  return (
    <div
      onClick={handleNav}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleNav()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${resource.name || resource.resource_id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'background 0.15s',
        marginBottom: 6,
      }}
    >
      <div
        style={{
          width: isBook ? 36 : 44,
          height: isBook ? 48 : 44,
          borderRadius: 4,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Icon size={16} color="var(--text-muted)" />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {resource.name || resource.resource_id}
        </div>
        {resource.subtitle && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {resource.subtitle}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
        {isOwner && (
          <>
            {isGmCampaign && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleShare(resource.id, !resource.shared)
                }}
                aria-label={
                  resource.shared ? t('resources.sharedAriaLabel') : t('resources.privateAriaLabel')
                }
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: resource.shared ? 'var(--gold)' : 'var(--text-muted)',
                  padding: '6px 4px',
                  margin: '-6px 0',
                  display: 'flex',
                }}
              >
                {resource.shared ? (
                  <LuEye size={14} aria-hidden="true" />
                ) : (
                  <LuEyeOff size={14} aria-hidden="true" />
                )}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove(resource.id)
              }}
              aria-label={`Remove ${resource.name || resource.resource_id}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '6px 4px',
                margin: '-6px 0',
                display: 'flex',
              }}
            >
              <LuTrash2 size={14} aria-hidden="true" />
            </button>
          </>
        )}
        {!isOwner && isGmCampaign && (
          <span
            style={{ fontSize: 11, color: resource.shared ? 'var(--gold)' : 'var(--text-muted)' }}
          >
            {resource.shared ? t('resources.shared') : t('resources.private')}
          </span>
        )}
        <LuChevronRight size={15} color="var(--text-muted)" />
      </div>
    </div>
  )
}

function ResourcePicker({ campaignId, isGmCampaign, linkedIds, onAdd, onClose }) {
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
  const [shared, setShared] = useState(false)
  const searchRef = useRef(null)
  const debounce = useRef(null)

  useEffect(() => {
    searchRef.current?.focus()
    doSearch('', '')
  }, [])

  const doSearch = (q, type) => {
    setLoading(true)
    campaigns
      .searchResources(q, type)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }

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
        shared,
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

      {isGmCampaign && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t('resources.shareByDefault')}
        </label>
      )}

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
                    <img
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

export default function ResourcesPanel({ campaign, isOwner }) {
  const { t } = useTranslation()
  const isGmCampaign = campaign.is_gm_campaign

  const TYPE_LABELS = {
    book: t('resources.books'),
    map: t('resources.maps'),
    token: t('resources.tokens'),
  }

  const [resources, setResources] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = () => {
    campaigns
      .listResources(campaign.id)
      .then(setResources)
      .catch(() => setResources([]))
  }

  useEffect(() => {
    load()
  }, [campaign.id])

  const remove = async (resourceId) => {
    await campaigns.removeResource(campaign.id, resourceId)
    load()
  }

  const toggleShare = async (resourceId, shared) => {
    await campaigns.updateResource(campaign.id, resourceId, shared)
    load()
  }

  if (!resources)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size={24} />
      </div>
    )

  const linkedIds = new Set(resources.map((r) => `${r.resource_type}:${r.resource_id}`))
  const grouped = Object.fromEntries(
    Object.keys(TYPE_ICONS).map((k) => [k, resources.filter((r) => r.resource_type === k)])
  )

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>{t('resources.title')}</h3>
        {isOwner && (
          <button
            onClick={() => setAdding(!adding)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <LuPlus size={14} /> {t('resources.linkResource')}
          </button>
        )}
      </div>

      {adding && isOwner && (
        <ResourcePicker
          campaignId={campaign.id}
          isGmCampaign={isGmCampaign}
          linkedIds={linkedIds}
          onAdd={() => load()}
          onClose={() => setAdding(false)}
        />
      )}

      {isOwner && !adding && isGmCampaign && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            marginBottom: 12,
            padding: '8px 12px',
            background: 'var(--bg-deep)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <LuEye size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />
          {t('resources.sharedNote')}
        </div>
      )}

      {resources.length === 0 && !adding ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <LuBookOpen size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>{t('resources.noResources')}</div>
        </div>
      ) : (
        Object.entries(grouped).map(([type, items]) => {
          if (items.length === 0) return null
          const { Icon } = TYPE_ICONS[type]
          const label = TYPE_LABELS[type]
          return (
            <section key={type} style={{ marginBottom: 20 }}>
              <h4
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Icon size={12} /> {label} ({items.length})
              </h4>
              {items.map((r) => (
                <ResourceRow
                  key={r.id}
                  resource={r}
                  isOwner={isOwner}
                  isGmCampaign={isGmCampaign}
                  onRemove={remove}
                  onToggleShare={toggleShare}
                />
              ))}
            </section>
          )
        })
      )}
    </div>
  )
}
