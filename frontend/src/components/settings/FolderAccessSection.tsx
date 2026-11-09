import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { settings as settingsApi, type Schema } from '../../api'
import { ACCESS_ADMIN, ACCESS_GM } from '../../accessLevels'
import Spinner from '../Spinner'
import FolderTree from '../files/FolderTree'
import ConfirmModal from './ConfirmModal'
import { badgeStyle, buttonStyle, failure, hintStyle, iconButtonStyle } from './filenameRulesStyles'

type Rule = Schema<'FolderAccessRuleOut'>
type Level = typeof ACCESS_GM | typeof ACCESS_ADMIN

// The collections that hold books. A rule goes on a folder *inside* one: the
// collection itself would restrict the whole library. Mirrors the backend's
// services/folder_access.validate.
const BOOK_COLLECTIONS = ['books', 'armory', 'armoury']

const inBookCollection = (path: string) => {
  const parts = path.split('/')
  return parts.length > 1 && BOOK_COLLECTIONS.includes(parts[0].toLowerCase())
}

const selectStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-control)',
  color: 'var(--text)',
  fontSize: 14,
}

/**
 * Folders whose books only GMs or admins can see (issue #772).
 *
 * Lets a GM's guide filed with a system's core books be kept from players
 * without restricting the core category, which everyone at the table needs.
 * A level change saves straight away, like the category matrix above it.
 */
export default function FolderAccessSection() {
  const { t } = useTranslation()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [pickedPath, setPickedPath] = useState<string | null>(null)
  const [pickedLevel, setPickedLevel] = useState<Level>(ACCESS_GM)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Rule | null>(null)

  const load = useCallback(() => {
    settingsApi
      .folderAccess()
      .then((body) => {
        setRules(body.rules)
        setError('')
      })
      .catch((err: unknown) => {
        setRules((prev) => prev ?? [])
        setError(failure(err) || t('appSettings.folderAccess.loadFailed'))
      })
  }, [t])

  useEffect(load, [load])

  const save = async (path: string, level: Level) => {
    setSaving(true)
    try {
      await settingsApi.saveFolderAccess(path, level)
      setAdding(false)
      setPickedPath(null)
      load()
    } catch (err) {
      setError(failure(err) || t('appSettings.folderAccess.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    const rule = removing
    setRemoving(null)
    if (!rule) return
    try {
      await settingsApi.deleteFolderAccess(rule.path)
      load()
    } catch (err) {
      setError(failure(err) || t('appSettings.folderAccess.removeFailed'))
    }
  }

  if (rules === null) return <Spinner size={20} />

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('appSettings.folderAccess.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        {t('appSettings.folderAccess.description')}
      </p>

      {error && (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {rules.length === 0 && !adding && (
        <p style={{ ...hintStyle, marginBottom: 12 }}>{t('appSettings.folderAccess.empty')}</p>
      )}

      {rules.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'grid', gap: 8 }}>
          {rules.map((rule) => (
            <li
              key={rule.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>
                  {rule.path}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <span style={badgeStyle('muted')}>
                    {t('appSettings.folderAccess.books', { count: rule.books })}
                  </span>
                  {!rule.exists && (
                    <span
                      style={badgeStyle('warn')}
                      title={t('appSettings.folderAccess.missingHint')}
                    >
                      {t('appSettings.folderAccess.missing')}
                    </span>
                  )}
                </div>
              </div>
              <select
                value={rule.level}
                onChange={(e) => void save(rule.path, e.target.value as Level)}
                aria-disabled={saving || undefined}
                aria-label={t('appSettings.folderAccess.levelLabel', { path: rule.path })}
                style={selectStyle}
              >
                <option value={ACCESS_GM}>{t('access.levels.gm')}</option>
                <option value={ACCESS_ADMIN}>{t('access.levels.admin')}</option>
              </select>
              <button
                type="button"
                onClick={() => setRemoving(rule)}
                aria-label={t('appSettings.folderAccess.removeLabel', { path: rule.path })}
                style={iconButtonStyle}
              >
                <LuTrash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!adding && (
        <button type="button" onClick={() => setAdding(true)} style={buttonStyle(true)}>
          <LuPlus size={13} /> {t('appSettings.folderAccess.add')}
        </button>
      )}

      {adding && (
        <div style={{ display: 'grid', gap: 10 }}>
          <FolderTree
            testId="folder-access-tree"
            selected={pickedPath}
            onSelect={(p) => {
              if (inBookCollection(p)) setPickedPath(p)
            }}
            isBlocked={(p) => !inBookCollection(p)}
            blockedLabel={t('appSettings.folderAccess.notBooks')}
            revealPath="books"
          />
          <p style={hintStyle}>
            {pickedPath ? <code>{pickedPath}</code> : t('appSettings.folderAccess.pickFolder')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <select
              value={pickedLevel}
              onChange={(e) => setPickedLevel(e.target.value as Level)}
              aria-label={t('appSettings.folderAccess.newLevelLabel')}
              style={selectStyle}
            >
              <option value={ACCESS_GM}>{t('access.levels.gm')}</option>
              <option value={ACCESS_ADMIN}>{t('access.levels.admin')}</option>
            </select>
            <button
              type="button"
              onClick={() => pickedPath && void save(pickedPath, pickedLevel)}
              disabled={!pickedPath || saving}
              style={buttonStyle(true, !pickedPath || saving)}
            >
              {t('appSettings.folderAccess.restrict')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setPickedPath(null)
              }}
              style={buttonStyle()}
            >
              {t('common.cancel')}
            </button>
            {saving && <Spinner size={13} />}
          </div>
        </div>
      )}

      {removing && (
        <ConfirmModal
          title={t('appSettings.folderAccess.removeTitle')}
          message={t('appSettings.folderAccess.removeConfirm', { path: removing.path })}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
