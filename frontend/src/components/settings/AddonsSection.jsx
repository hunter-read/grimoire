import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuArrowUp,
  LuDownload,
  LuLink,
  LuRefreshCw,
  LuTrash2,
  LuTriangleAlert,
} from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import AddonInstallDialog from './AddonInstallDialog'

/**
 * Admin panel for community add-ons (issue #203).
 *
 * Lists what is installed and what the community index offers, and manages the
 * index URL plus the global "allow add-on scripts" switch. Installing a
 * script-backed add-on routes through a confirmation dialog; YAML-only add-ons
 * install directly, since nothing third-party executes for those.
 */
export default function AddonsSection() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [indexUrl, setIndexUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState(null)
  // The index URL field is hidden until asked for — the default suits
  // almost every install.
  const [editingIndex, setEditingIndex] = useState(false)

  const load = useCallback(() => {
    api
      .get('/addons')
      .then((body) => {
        setData(body)
        setIndexUrl(body.index_url || '')
      })
      .catch((e) => setError(e.message))
  }, [])

  useEffect(load, [load])

  const run = (promise, successMessage) => {
    setBusy(true)
    setError('')
    setNotice('')
    return promise
      .then(() => {
        if (successMessage) setNotice(successMessage)
        load()
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const refresh = () =>
    run(
      api
        .patch('/addons/settings', { index_url: indexUrl })
        .then(() => api.post('/addons/refresh')),
      t('addons.refreshed')
    )

  const install = (addon, approveScript = false) =>
    run(
      api.post(`/addons/${addon.id}/install`, { approve_script: approveScript }),
      t('addons.installed', { name: addon.name })
    )

  // Updating is the same install call — the version in the index is what gets
  // fetched. A script-backed add-on whose script changed comes back unapproved,
  // so consent is re-asked rather than inherited.
  const update = (addon) =>
    addon.requires_script
      ? setConfirming({ ...addon, updating: true })
      : run(
          api.post(`/addons/${addon.id}/install`, { approve_script: false }),
          t('addons.updated', { name: addon.name })
        )

  const updateAll = () =>
    run(
      api.post('/addons/update-all').then((res) => {
        const count = (res?.updated || []).length
        setNotice(count ? t('addons.updatedCount', { count }) : t('addons.alreadyUpToDate'))
      })
    )

  const startInstall = (addon) => {
    // Only code-bearing add-ons need consent; plain YAML installs straight away.
    if (addon.requires_script) setConfirming(addon)
    else install(addon)
  }

  const toggleScripts = (allow) => run(api.patch('/addons/settings', { allow_scripts: allow }))

  const toggleEnabled = (addon) =>
    run(api.patch(`/addons/${addon.id}`, { enabled: !addon.enabled }))

  const remove = (addon) =>
    run(api.delete(`/addons/${addon.id}`), t('addons.removed', { name: addon.name }))

  if (!data) return <Spinner />

  const installedIds = new Set(data.installed.map((a) => a.id))
  const pendingUpdates = data.installed.filter((a) => a.update_available).length
  const notInstalled = data.available.filter((a) => !installedIds.has(a.id))
  // An older server may not report the default, in which case treat the
  // configured URL as the default rather than crying "custom".
  const isCustomIndex = !!data.default_index_url && indexUrl !== data.default_index_url

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* The default index is right for almost everyone, so the URL field
            stays behind a button rather than sitting at the top of the page
            inviting edits. */}
        <span style={{ flex: 1, minWidth: 240, alignSelf: 'center', fontSize: 13 }}>
          {isCustomIndex ? t('addons.indexCustom') : t('addons.indexDefault')}
        </span>
        <button
          onClick={() => setEditingIndex((v) => !v)}
          aria-label={t('addons.changeIndex')}
          title={t('addons.changeIndex')}
          aria-expanded={editingIndex}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--text-dim)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          <LuLink size={14} />
        </button>
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
      </div>

      {editingIndex && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={indexUrl}
            onChange={(e) => setIndexUrl(e.target.value)}
            aria-label={t('addons.indexUrl')}
            placeholder={t('addons.indexUrl')}
            style={{
              flex: 1,
              minWidth: 240,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--bg-deep)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
            }}
          />
          <button
            onClick={() => setIndexUrl(data.default_index_url || '')}
            disabled={busy || !isCustomIndex}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              cursor: busy || !isCustomIndex ? 'default' : 'pointer',
            }}
          >
            {t('addons.indexReset')}
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--danger, #c0392b)',
            marginBottom: 12,
          }}
        >
          <LuTriangleAlert size={14} />
          {error}
        </p>
      )}
      {notice && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>{notice}</p>
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {addon.name}{' '}
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>
                  v{addon.version}
                </span>
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
              {!addon.runnable && addon.blocked_reason && (
                <div style={{ fontSize: 12, color: 'var(--warning, #d98324)' }}>
                  {addon.blocked_reason}
                </div>
              )}
            </div>
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {addon.name}{' '}
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>
                  v{addon.version}
                </span>
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
            </div>
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

      {confirming && (
        <AddonInstallDialog
          addon={confirming}
          onConfirm={() => {
            install(confirming, true)
            setConfirming(null)
          }}
          updating={!!confirming.updating}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
