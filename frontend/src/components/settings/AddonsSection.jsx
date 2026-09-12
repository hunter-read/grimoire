import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuArrowUp,
  LuDownload,
  LuLink,
  LuRefreshCw,
  LuTrash2,
  LuTriangleAlert,
  LuPlus,
  LuMenu,
  LuBadgeCheck,
  LuCheck,
} from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import AddonInstallDialog from './AddonInstallDialog'
import AuthorByline from './AuthorByline'
import CollapsibleSection from './CollapsibleSection'

function formatIndexUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('githubusercontent.com') || parsed.hostname.includes('github.com')) {
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
    }
    return parsed.hostname
  } catch (e) {
    return url
  }
}

function ConfirmModal({ title, message, onConfirm, onClose }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 400,
          maxWidth: '92vw',
          boxSizing: 'border-box',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 16, marginBottom: 8 }}>{title}</h3>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: 'var(--danger, #c0392b)',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t('common.confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AddonsSection() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [indexUrls, setIndexUrls] = useState([])
  const [newIndexUrl, setNewIndexUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const load = useCallback(() => {
    api
      .get('/addons')
      .then((body) => {
        setData(body)
        setIndexUrls(body.index_urls || [])
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  const run = (promise, successMessage, errorSetter = setError, onSuccess = null) => {
    setBusy(true)
    setError('')
    setSourceError('')
    setNotice('')
    return promise
      .then(() => {
        if (successMessage) setNotice(successMessage)
        if (onSuccess) onSuccess()
        load()
      })
      .catch((e) => errorSetter(e.message))
      .finally(() => setBusy(false))
  }

  const saveIndexUrls = (newUrls, onSuccess) => {
    return run(api.patch('/addons/settings', { index_urls: newUrls }), null, setSourceError, onSuccess)
  }

  const addIndexUrl = () => {
    if (!newIndexUrl) return
    const updated = [...indexUrls, newIndexUrl]
    saveIndexUrls(updated, () => setNewIndexUrl(''))
  }

  const requestRemoveIndex = (index) => setConfirmRemove(index)
  const executeRemoveIndex = () => {
    if (confirmRemove === null) return
    const updated = indexUrls.filter((_, i) => i !== confirmRemove)
    setConfirmRemove(null)
    saveIndexUrls(updated)
  }

  const requestResetIndex = () => setConfirmReset(true)
  const executeResetIndex = () => {
    const updated = [data.default_index_url]
    setConfirmReset(false)
    saveIndexUrls(updated)
  }

  const refresh = () =>
    run(
      api.post('/addons/refresh').then((res) => {
        if (res.errors && res.errors.length > 0) {
          setError(res.errors.map(e => `${e.url}: ${e.error}`).join(' | '))
        }
      }),
      t('addons.refreshed')
    )

  const install = (addon, approveScript = false, specificIndexUrl = null) =>
    run(
      api.post(`/addons/${addon.id}/install`, { approve_script: approveScript, index_url: specificIndexUrl || addon.index_url }),
      t('addons.installed', { name: addon.name })
    )

  // Updating is the same install call — the version in the index is what gets
  // fetched. A script-backed add-on whose script changed comes back unapproved,
  // so consent is re-asked rather than inherited.
  const update = (addon, specificIndexUrl = null) => {
    const hasNewChangelog = (addon.changelog || []).length > 0
    const targetIndexUrl = specificIndexUrl || addon.index_url
    if (addon.requires_script || hasNewChangelog) {
      setConfirming({ ...addon, updating: true, targetIndexUrl })
    } else {
      run(
        api.post(`/addons/${addon.id}/install`, { approve_script: false, index_url: targetIndexUrl }),
        t('addons.updated', { name: addon.name })
      )
    }
  }

  const updateAll = () =>
    run(
      api.post('/addons/update-all').then((res) => {
        if (res.errors && res.errors.length > 0) {
          setError(res.errors.map(e => `${e.url}: ${e.error}`).join(' | '))
        }
        return res.updated
      }),
      null
    ).then((count) => {
        setNotice(count ? t('addons.updatedCount', { count }) : t('addons.alreadyUpToDate'))
    })

  const startInstall = (addon, specificIndexUrl = null) => {
    // Only code-bearing add-ons need consent; plain YAML installs straight away.
    // (We also now show the confirmation dialog for YAML add-ons if they have a changelog)
    const hasChangelog = addon.changelog && addon.changelog.length > 0
    const targetIndexUrl = specificIndexUrl || addon.index_url
    if (addon.requires_script || hasChangelog) {
      setConfirming({ ...addon, targetIndexUrl })
    } else {
      install(addon, false, targetIndexUrl)
    }
  }

  const toggleScripts = (allow) => run(api.patch('/addons/settings', { allow_scripts: allow }))

  const toggleEnabled = (addon) =>
    run(api.patch(`/addons/${addon.id}`, { enabled: !addon.enabled }))

  const remove = (addon) =>
    run(api.delete(`/addons/${addon.id}`), t('addons.removed', { name: addon.name }))

  const handleContextMenu = (e, addon, isUpdate) => {
    e.preventDefault()
    if (!addon.available_in || addon.available_in.length <= 1) return
    setContextMenu({ x: e.clientX, y: e.clientY, addon, isUpdate })
  }

  if (!data) return <Spinner />

  const installedIds = new Set(data.installed.map((a) => a.id))
  const pendingUpdates = data.installed.filter((a) => a.update_available).length
  const notInstalled = data.available.filter((a) => !installedIds.has(a.id))
  
  // An older server may not report the default, in which case treat the
  // configured URL as the default rather than crying "custom".
  const isCustomIndex = indexUrls.length !== 1 || indexUrls[0] !== data.default_index_url

  return (
    <div>
      {/* The index URL section is closed by default — the default suits almost every install. */}
      <CollapsibleSection
        title={t('addons.configuredSources', 'Add-on Sources')}
        description={t('addons.sourcesDesc', 'Configure where Grimoire looks for add-ons.')}
        storageKey="grimoire:settings:addons:sources"
        defaultOpen={false}
      >
        <div style={{ marginBottom: 24 }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {indexUrls.map((url, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-deep)', padding: '10px 12px', borderRadius: 6 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {formatIndexUrl(url)}
                    {url.includes('grimoire-codex/community-add-ons') && (
                      <LuBadgeCheck size={16} color="var(--gold-dim)" title={t('addons.verifiedSource', 'Verified Source')} />
                    )}
                  </span>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all', textDecoration: 'underline' }}>{url}</a>
                </div>
                <button
                  onClick={() => requestRemoveIndex(i)}
                  disabled={busy}
                  title={t('addons.remove')}
                  style={{ background: 'none', border: 'none', color: 'var(--danger, #c0392b)', cursor: 'pointer', padding: 8, borderRadius: 4 }}
                >
                  <LuTrash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={newIndexUrl}
              onChange={(e) => setNewIndexUrl(e.target.value)}
              placeholder={t('addons.addIndexUrl', 'Add new index URL...')}
              style={{
                flex: 1,
                minWidth: 240,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                fontSize: 13
              }}
            />
            <button
              onClick={addIndexUrl}
              disabled={busy || !newIndexUrl}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                background: 'var(--border)',
                border: 'none',
                color: 'var(--text)',
                cursor: busy || !newIndexUrl ? 'default' : 'pointer',
                fontWeight: 500,
                fontSize: 13
              }}
            >
              <LuPlus size={14} />
              {t('addons.add', 'Add')}
            </button>
            <button
              onClick={requestResetIndex}
              disabled={busy || !isCustomIndex}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                background: 'none',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                cursor: busy || !isCustomIndex ? 'default' : 'pointer',
                fontSize: 13
              }}
            >
              {t('addons.indexReset')}
            </button>
          </div>
          {sourceError && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--danger, #c0392b)',
                background: 'var(--bg-deep)',
                padding: '10px 12px',
                borderRadius: 6,
                marginTop: 16,
                border: '1px solid var(--danger, #c0392b)',
                wordBreak: 'break-word',
              }}
            >
              <LuTriangleAlert size={16} style={{ flexShrink: 0 }} />
              <span>{sourceError}</span>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('addons.categories.metadata')}
        description={t('addons.categories.metadataDesc')}
        storageKey="grimoire:settings:addons:metadata"
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={refresh}
            disabled={busy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 6,
              background: 'var(--gold-dim)',
              color: 'var(--bg-deep)',
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            <LuRefreshCw size={14} />
            {t('addons.refresh')}
          </button>
          {pendingUpdates > 0 && (
            <button
              onClick={updateAll}
              disabled={busy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid var(--gold-dim)',
                background: 'none',
                color: 'var(--gold-dim)',
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              <LuArrowUp size={14} />
              {t('addons.updateAll', { count: pendingUpdates })}
            </button>
          )}
          {notice && (
            <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <LuCheck size={14} color="var(--gold-dim)" />
              {notice}
            </span>
          )}
        </div>

        {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--danger, #c0392b)',
            background: 'var(--bg-deep)',
            padding: '10px 12px',
            borderRadius: 6,
            marginBottom: 16,
            border: '1px solid var(--danger, #c0392b)',
            wordBreak: 'break-word',
          }}
        >
          <LuTriangleAlert size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        {t('addons.installedHeading')}
      </h4>
      {data.installed.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
          {t('addons.noneInstalled')}
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
        {data.installed.map((addon) => (
          <li
            key={addon.id}
            onContextMenu={(e) => handleContextMenu(e, addon, true)}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--bg-deep)',
              marginBottom: 6,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {addon.name}{' '}
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>
                  v{addon.version}
                </span>
                {addon.index_url && (
                  <span
                    title={addon.index_url.includes('grimoire-codex/community-add-ons') ? t('addons.verifiedSource', 'Verified Source') : undefined}
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      color: addon.index_url.includes('grimoire-codex/community-add-ons') ? 'var(--gold-dim)' : 'var(--text-muted)',
                      border: `1px solid ${addon.index_url.includes('grimoire-codex/community-add-ons') ? 'var(--gold-dim)' : 'var(--border)'}`,
                      borderRadius: 4,
                      padding: '1px 4px',
                      textTransform: 'uppercase',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      verticalAlign: 'middle',
                      marginTop: -2,
                    }}
                  >
                    {addon.index_url.includes('grimoire-codex/community-add-ons') && <LuBadgeCheck size={12} />}
                    {formatIndexUrl(addon.index_url)}
                  </span>
                )}
                {addon.update_available && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: 'var(--gold-dim)',
                      border: '1px solid var(--gold-dim)',
                      borderRadius: 4,
                      padding: '1px 5px',
                    }}
                  >
                    {t('addons.updateBadge', { version: addon.available_version })}
                  </span>
                )}
              </div>
              {addon.description && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{addon.description}</div>
              )}
              <AuthorByline author={addon.author} authorUrl={addon.author_url} />
              {!addon.runnable && addon.blocked_reason && (
                <div style={{ fontSize: 12, color: 'var(--warning, #d98324)' }}>
                  {addon.blocked_reason}
                </div>
              )}
            </div>
            {addon.available_in && addon.available_in.length > 1 && (
               <button
                 onClick={(e) => { e.stopPropagation(); handleContextMenu(e, addon, true); }}
                 title="More options"
                 style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
               >
                 <LuMenu size={16} />
               </button>
            )}
            {addon.update_available && (
              <button
                onClick={() => update(addon)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--gold-dim)',
                  color: 'var(--bg-deep)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                <LuArrowUp size={13} />
                {t('addons.update')}
              </button>
            )}
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={addon.enabled}
                onChange={() => toggleEnabled(addon)}
                aria-label={t('addons.enabled')}
              />
              {t('addons.enabled')}
            </label>
            <button
              onClick={() => remove(addon)}
              aria-label={t('addons.remove')}
              title={t('addons.remove')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                padding: 4,
              }}
            >
              <LuTrash2 size={16} />
            </button>
          </li>
        ))}
      </ul>

      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        {t('addons.availableHeading')}
      </h4>
      {notInstalled.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
          {t('addons.noneAvailable')}
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
        {notInstalled.map((addon) => (
          <li
            key={addon.id}
            onContextMenu={(e) => handleContextMenu(e, addon, false)}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--bg-deep)',
              marginBottom: 6,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {addon.name}{' '}
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>
                  v{addon.version}
                </span>
                {addon.index_url && (
                  <span
                    title={addon.index_url.includes('grimoire-codex/community-add-ons') ? t('addons.verifiedSource', 'Verified Source') : undefined}
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      color: addon.index_url.includes('grimoire-codex/community-add-ons') ? 'var(--gold-dim)' : 'var(--text-muted)',
                      border: `1px solid ${addon.index_url.includes('grimoire-codex/community-add-ons') ? 'var(--gold-dim)' : 'var(--border)'}`,
                      borderRadius: 4,
                      padding: '1px 4px',
                      textTransform: 'uppercase',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      verticalAlign: 'middle',
                      marginTop: -2,
                    }}
                  >
                    {addon.index_url.includes('grimoire-codex/community-add-ons') && <LuBadgeCheck size={12} />}
                    {formatIndexUrl(addon.index_url)}
                  </span>
                )}
                {addon.requires_script && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: 'var(--warning, #d98324)',
                      border: '1px solid var(--warning, #d98324)',
                      borderRadius: 4,
                      padding: '1px 5px',
                    }}
                  >
                    {t('addons.runsCode')}
                  </span>
                )}
              </div>
              {addon.description && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{addon.description}</div>
              )}
              <AuthorByline author={addon.author} authorUrl={addon.author_url} />
            </div>
            {addon.available_in && addon.available_in.length > 1 && (
               <button
                 onClick={(e) => { e.stopPropagation(); handleContextMenu(e, addon, false); }}
                 title="More options"
                 style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
               >
                 <LuMenu size={16} />
               </button>
            )}
            <button
              onClick={() => startInstall(addon)}
              disabled={busy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'none',
                color: 'var(--text)',
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              <LuDownload size={14} />
              {t('addons.install')}
            </button>
          </li>
        ))}
      </ul>

      <label
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          fontSize: 13,
          padding: '12px',
          borderRadius: 6,
          background: 'var(--bg-deep)',
        }}
      >
        <input
          type="checkbox"
          checked={data.allow_scripts}
          onChange={(e) => toggleScripts(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          <strong>{t('addons.allowScripts')}</strong>
          <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>
            {t('addons.allowScriptsDesc')}
          </div>
        </span>
      </label>
      </CollapsibleSection>

      {confirming && (
        <AddonInstallDialog
          addon={confirming}
          onConfirm={() => {
            install(confirming, true, confirming.targetIndexUrl)
            setConfirming(null)
          }}
          updating={!!confirming.updating}
          onClose={() => setConfirming(null)}
        />
      )}

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
            zIndex: 1000,
            minWidth: 200,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
            {contextMenu.isUpdate ? 'Update from specific index' : 'Install from specific index'}
          </div>
          {contextMenu.addon.available_in.map((avail, i) => (
            <button
              key={i}
              onClick={() => {
                if (contextMenu.isUpdate) update(contextMenu.addon, avail.index_url)
                else startInstall(contextMenu.addon, avail.index_url)
                setContextMenu(null)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseOver={(e) => (e.target.style.background = 'var(--bg-hover)')}
              onMouseOut={(e) => (e.target.style.background = 'none')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {avail.index_url.includes('grimoire-codex/community-add-ons') && <LuBadgeCheck size={14} color="var(--gold-dim)" title={t('addons.verifiedSource', 'Verified Source')} />}
                <span>{formatIndexUrl(avail.index_url)} (v{avail.version})</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {confirmRemove !== null && (
        <ConfirmModal
          title={t('addons.confirmRemoveIndexTitle', 'Remove Index')}
          message={t('addons.confirmRemoveIndex', 'Are you sure you want to remove this index?')}
          onConfirm={executeRemoveIndex}
          onClose={() => setConfirmRemove(null)}
        />
      )}

      {confirmReset && (
        <ConfirmModal
          title={t('addons.confirmResetIndexTitle', 'Reset Indexes')}
          message={t('addons.confirmResetIndex', 'Reset to default index?')}
          onConfirm={executeResetIndex}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </div>
  )
}
