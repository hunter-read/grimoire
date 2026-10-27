import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPackage, LuStore, LuTrash2 } from 'react-icons/lu'
import { content as contentApi, rulesets as rulesetsApi } from '../../api'
import { useAuth } from '../../context/AuthContext'
import Spinner from '../Spinner'
import PackCatalogue from './PackCatalogue'
import {
  ghostBtn,
  iconBtn,
  card,
  sectionBar,
  sectionTitle,
  helpText,
  emptyState,
} from './characterStyles'

/**
 * The content packs installed on this server.
 *
 * A pack is usable by every character on a matching sheet the moment it is
 * installed - the content browser reads packs directly - so it belongs in plain
 * sight here rather than only inside the catalogue. Installing and removing one
 * is an admin's job, since a pack is shared by everyone.
 */
export default function InstalledPacks({ schemas, onChanged }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [packs, setPacks] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const list = await contentApi.packs()
      setPacks(list.packs || [])
      setError('')
    } catch (e) {
      setPacks([])
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sheetName = (schemaId) =>
    schemas.find((schema) => schema.schema_id === schemaId)?.name || schemaId

  const uninstall = async (pack) => {
    if (!window.confirm(t('contentPacks.confirmUninstall', { name: pack.name }))) return
    try {
      await rulesetsApi.uninstallPack(pack.pack_id)
      await load()
      onChanged?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section aria-labelledby="installed-packs-heading" style={{ marginBottom: 28 }}>
      <div style={sectionBar}>
        <h3 id="installed-packs-heading" style={sectionTitle}>
          {t('contentPacks.title')}
        </h3>
        <button type="button" onClick={() => setBrowsing(true)} style={ghostBtn}>
          <LuStore size={14} aria-hidden="true" />
          {t('contentPacks.browse')}
        </button>
      </div>
      <p style={{ ...helpText, margin: '0 0 12px' }}>{t('contentPacks.installedHelp')}</p>

      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {packs === null ? (
        <Spinner />
      ) : packs.length === 0 ? (
        <p style={emptyState}>{t('contentPacks.emptyInstalled')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {packs.map((pack) => (
            <li
              key={pack.pack_id}
              style={{
                ...card,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
              }}
            >
              <LuPackage
                size={18}
                aria-hidden="true"
                color="var(--gold)"
                style={{ flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{pack.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {[
                    t('contentPacks.forSheet', { sheet: sheetName(pack.schema_id) }),
                    pack.version ? `v${pack.version}` : '',
                    t('contentPacks.entries', { count: pack.entry_count }),
                    pack.license,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => uninstall(pack)}
                  aria-label={t('contentPacks.uninstall', { name: pack.name })}
                  title={t('contentPacks.uninstall', { name: pack.name })}
                  style={iconBtn}
                >
                  <LuTrash2 size={15} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {browsing ? (
        <PackCatalogue
          onInstalled={() => {
            load()
            onChanged?.()
          }}
          onClose={() => {
            setBrowsing(false)
            load()
          }}
        />
      ) : null}
    </section>
  )
}
