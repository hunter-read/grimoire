import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'
import ApiKeyPermissionGroup from './ApiKeyPermissionGroup'
import ApiKeyPermissionRow from './ApiKeyPermissionRow'
import {
  ALL,
  EXPIRY_CHOICES,
  effectiveLevel,
  expiryFromDays,
  formatWhen,
  rank,
} from './apiKeyUtils'

const KEEP = 'keep'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 14,
}

// Create or edit an API key: its name, expiry, and a No access / Read / Read and
// Write level per permission, plus an All permissions level that sets a floor
// for every area, including ones added in later versions. `apiKey` is null when
// creating.
//
// Permissions are listed in collapsible groups (the server says which), with a
// filter box above them, so the list stays findable as more areas are added.
export default function ApiKeyDialog({ apiKey, permissions, onSave, onClose }) {
  const { t, i18n } = useTranslation()
  const editing = Boolean(apiKey)
  const [name, setName] = useState(apiKey?.name || '')
  const [levels, setLevels] = useState(() => ({ ...(apiKey?.permissions || {}) }))
  // Editing starts on "keep the current expiry"; creating defaults to 90 days.
  const [expiry, setExpiry] = useState(editing ? KEEP : '90')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  // Groups start open where the key already reaches something, so an edit shows
  // what it grants; a new key starts with everything folded.
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = apiKey?.permissions || {}
    return new Set(
      permissions
        .filter((perm) => rank(effectiveLevel(initial, perm)) > 0)
        .map((perm) => perm.group)
    )
  })

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const floor = levels[ALL] || 'none'
  const allRow = {
    id: ALL,
    label: t('appSettings.apiKeys.permissions.all.label'),
    description: t('appSettings.apiKeys.permissions.all.description'),
    levels: ['none', 'read', 'write'],
    emphasis: true,
  }
  const rows = permissions.map((perm) => ({
    ...perm,
    label: t(`appSettings.apiKeys.permissions.${perm.id}.label`, perm.id),
    description: t(`appSettings.apiKeys.permissions.${perm.id}.description`, perm.description),
  }))

  // Group in the order the server lists permissions (it lists them group by
  // group), so a new group appears without a client change.
  const needle = query.trim().toLowerCase()
  const matches = (row) =>
    !needle || `${row.label} ${row.description} ${row.id}`.toLowerCase().includes(needle)
  const groups = []
  for (const row of rows) {
    const id = row.group || 'other'
    let group = groups.find((g) => g.id === id)
    if (!group) {
      group = { id, rows: [], granted: 0 }
      groups.push(group)
    }
    group.rows.push(row)
    if (rank(effectiveLevel(levels, row)) > 0) group.granted += 1
  }
  const visibleGroups = groups
    .map((g) => ({ ...g, shown: g.rows.filter(matches) }))
    .filter((g) => g.shown.length > 0)

  const setLevel = (id, level) => setLevels((prev) => ({ ...prev, [id]: level }))
  const toggleGroup = (id) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('appSettings.apiKeys.dialog.nameRequired'))
      return
    }
    const payload = { name: name.trim(), permissions: levels }
    if (expiry !== KEEP) {
      payload.expires_at = expiryFromDays(expiry === 'never' ? null : Number(expiry))
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(payload)
    } catch (err) {
      setError(err?.message || t('appSettings.apiKeys.dialog.saveFailed'))
      setSaving(false)
    }
  }

  const currentExpiry = apiKey?.expires_at
    ? t('appSettings.apiKeys.dialog.keepExpiry', {
        when: formatWhen(apiKey.expires_at, i18n.language),
      })
    : t('appSettings.apiKeys.dialog.keepNever')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-dialog-title"
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
      <form
        onSubmit={submit}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 640,
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <h3 id="api-key-dialog-title" style={{ marginTop: 0, fontSize: 16, marginBottom: 16 }}>
          {editing
            ? t('appSettings.apiKeys.dialog.editTitle')
            : t('appSettings.apiKeys.dialog.createTitle')}
        </h3>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <label style={{ flex: '2 1 240px', fontSize: 13, color: 'var(--text-dim)' }}>
            {t('appSettings.apiKeys.dialog.name')}
            <input
              type="text"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('appSettings.apiKeys.dialog.namePlaceholder')}
              style={{ ...inputStyle, marginTop: 4 }}
              autoFocus
            />
          </label>
          <label style={{ flex: '1 1 160px', fontSize: 13, color: 'var(--text-dim)' }}>
            {t('appSettings.apiKeys.dialog.expiration')}
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            >
              {editing && <option value={KEEP}>{currentExpiry}</option>}
              {EXPIRY_CHOICES.map((days) =>
                days == null ? (
                  <option key="never" value="never">
                    {t('appSettings.apiKeys.dialog.never')}
                  </option>
                ) : (
                  <option key={days} value={String(days)}>
                    {t('appSettings.apiKeys.dialog.days', { count: days })}
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          {t('appSettings.apiKeys.dialog.permissions')}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
          {t('appSettings.apiKeys.dialog.permissionsHint')}
        </p>
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-card)',
            marginBottom: 12,
          }}
        >
          <ApiKeyPermissionRow
            perm={allRow}
            value={floor}
            floor="none"
            covered={false}
            onChange={setLevel}
            first
          />
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('appSettings.apiKeys.dialog.filter')}
          aria-label={t('appSettings.apiKeys.dialog.filter')}
          style={{ ...inputStyle, marginBottom: 10 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {visibleGroups.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0' }}>
              {t('appSettings.apiKeys.dialog.noMatches', { query: query.trim() })}
            </p>
          )}
          {visibleGroups.map((group) => (
            <ApiKeyPermissionGroup
              key={group.id}
              id={group.id}
              // A filter opens every group with a match, so results are never
              // hidden behind a closed header.
              open={Boolean(needle) || openGroups.has(group.id)}
              onToggle={toggleGroup}
              granted={group.granted}
              total={group.rows.length}
            >
              {group.shown.map((perm, i) => (
                <ApiKeyPermissionRow
                  key={perm.id}
                  perm={perm}
                  value={effectiveLevel(levels, perm)}
                  floor={floor}
                  // Nothing left to raise once All permissions already reaches
                  // this area's highest level.
                  covered={rank(floor) >= rank(perm.levels[perm.levels.length - 1])}
                  onChange={setLevel}
                  first={i === 0}
                />
              ))}
            </ApiKeyPermissionGroup>
          ))}
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            type="button"
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
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 6,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              cursor: saving ? 'default' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving && <Spinner size={12} />}
            {editing
              ? t('appSettings.apiKeys.dialog.save')
              : t('appSettings.apiKeys.dialog.create')}
          </button>
        </div>
      </form>
    </div>
  )
}
