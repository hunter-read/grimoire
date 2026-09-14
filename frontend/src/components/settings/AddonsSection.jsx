import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowUp, LuRefreshCw, LuTriangleAlert, LuPlus, LuCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import AddonInstallDialog from './AddonInstallDialog'
import PluginSourcePill from './PluginSourcePill'
import PluginSourceRow from './PluginSourceRow'
import PluginCard from './PluginCard'
import PluginSourceContextMenu from './PluginSourceContextMenu'
import AuthorByline from './AuthorByline'
import CollapsibleSection from './CollapsibleSection'
import ConfirmModal from './ConfirmModal'

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
        setIndexUrls(body.index_urls || (body.index_url ? [body.index_url] : []))
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(load, [load])

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
    return run(
      api.patch('/addons/settings', { index_urls: newUrls }),
      null,
      setSourceError,
      onSuccess
    )
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
          setError(res.errors.map((e) => `${e.url}: ${e.error}`).join(' | '))
        }
      }),
      t('addons.refreshed')
    )

  const install = (addon, approveScript = false, specificIndexUrl = null) =>
    run(
      api.post(`/addons/${addon.id}/install`, {
        approve_script: approveScript,
        index_url: specificIndexUrl || addon.index_url,
      }),
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
        api.post(`/addons/${addon.id}/install`, {
          approve_script: false,
          index_url: targetIndexUrl,
        }),
        t('addons.updated', { name: addon.name })
      )
    }
  }

  const updateAll = () =>
    run(
      api.post('/addons/update-all').then((res) => {
        if (res.errors && res.errors.length > 0) {
          setError(res.errors.map((e) => `${e.url}: ${e.error}`).join(' | '))
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
        description={t(
          'addons.sourcesDesc',
          'Configure where Grimoire looks for add-ons, themes, and note templates.'
        )}
        storageKey="grimoire:settings:addons:sources"
        defaultOpen={false}
      >
        <div style={{ marginBottom: 24 }}>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0 0 16px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {indexUrls.map((url, i) => (
              <PluginSourceRow
                key={i}
                url={url}
                index={i}
                data={data}
                busy={busy}
                onRemove={requestRemoveIndex}
              />
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={newIndexUrl}
              onChange={(e) => setNewIndexUrl(e.target.value)}
              placeholder={t(
                'addons.addIndexUrl',
                'Add index URL (e.g. https://.../index.json or index.yaml)...'
              )}
              style={{
                flex: 1,
                minWidth: 240,
                padding: '8px 12px',
                borderRadius: 6,
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                fontSize: 13,
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
                fontSize: 13,
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
                fontSize: 13,
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
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 16,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
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
            <span
              style={{
                marginLeft: 8,
                fontSize: 13,
                color: 'var(--text-dim)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
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
            <PluginCard
              key={addon.id}
              addon={addon}
              isInstalled={true}
              trustedIndexUrls={data?.trusted_index_urls || []}
              busy={busy}
              onContextMenu={handleContextMenu}
              onUpdate={update}
              onToggleEnabled={toggleEnabled}
              onRemove={remove}
            />
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
            <PluginCard
              key={addon.id}
              addon={addon}
              isInstalled={false}
              trustedIndexUrls={data?.trusted_index_urls || []}
              busy={busy}
              onContextMenu={handleContextMenu}
              onInstall={startInstall}
            />
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
          defaultIndexUrl={data?.default_index_url}
          trustedIndexUrls={data?.trusted_index_urls || []}
          onConfirm={() => {
            install(confirming, true, confirming.targetIndexUrl)
            setConfirming(null)
          }}
          updating={!!confirming.updating}
          onClose={() => setConfirming(null)}
        />
      )}

      {contextMenu && (
        <PluginSourceContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isUpdate={contextMenu.isUpdate}
          sources={contextMenu.addon.available_in}
          defaultIndexUrl={data?.default_index_url}
          trustedIndexUrls={data?.trusted_index_urls || []}
          onSelect={(indexUrl) => {
            if (contextMenu.isUpdate) update(contextMenu.addon, indexUrl)
            else startInstall(contextMenu.addon, indexUrl)
          }}
          onClose={() => setContextMenu(null)}
        />
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
