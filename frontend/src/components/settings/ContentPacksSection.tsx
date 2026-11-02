import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRefreshCw, LuExternalLink, LuTrash2 } from 'react-icons/lu'
import { content as contentApi, contentAdmin, rulesets as rulesetsApi } from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'
import { ghostBtn, iconBtn, card } from '../characters/characterStyles'

type Pack = Schema<'PackSummary'>

/**
 * Installed character content packs, and the credit each is published under.
 * Its group on the Add-ons page supplies the heading.
 *
 * Packs are filesystem-installed — an admin drops a directory into
 * `DATA_PATH/character-content/` — so this lists what is there and re-reads it
 * on demand rather than offering an upload. Restarting to pick up a new pack
 * would be a poor way to find out you had mistyped the directory name.
 *
 * Attribution is rendered verbatim: several open licences mandate exact
 * wording, and paraphrasing one is how a licence gets breached.
 */
export default function ContentPacksSection() {
  const { t } = useTranslation()
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [removing, setRemoving] = useState<Pack | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await contentApi.packs()
      setPacks(result.packs || [])
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const uninstall = async (pack: Pack) => {
    setRemoving(null)
    try {
      await rulesetsApi.uninstallPack(pack.pack_id)
      setPacks((prev) => prev.filter((row) => row.pack_id !== pack.pack_id))
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const reload = async () => {
    setReloading(true)
    try {
      const result = await contentAdmin.reloadPacks()
      setPacks(result.packs || [])
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReloading(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '8px 16px',
          marginBottom: 12,
        }}
      >
        <p
          style={{
            flex: '1 1 320px',
            maxWidth: '70ch',
            margin: 0,
            color: 'var(--text-dim)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {t('contentPacks.help')}
        </p>
        <button onClick={reload} disabled={reloading} style={ghostBtn}>
          <LuRefreshCw size={14} aria-hidden="true" />
          {reloading ? t('contentPacks.reloading') : t('contentPacks.reload')}
        </button>
      </div>

      {error ? (
        <div role="alert" style={{ color: 'var(--danger)', marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {packs.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('contentPacks.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {packs.map((pack) => (
            <li key={pack.pack_id} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ overflowWrap: 'anywhere' }}>{pack.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  v{pack.version} · {pack.schema_id} ·{' '}
                  {t('contentPacks.entries', { count: pack.entry_count })}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => setRemoving(pack)}
                  aria-label={t('contentPacks.uninstall', { name: pack.name })}
                  title={t('contentPacks.uninstall', { name: pack.name })}
                  style={iconBtn}
                >
                  <LuTrash2 size={14} aria-hidden="true" />
                </button>
              </div>
              {pack.description ? (
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
                  {pack.description}
                </p>
              ) : null}
              {pack.attribution ? (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {pack.attribution}
                  {pack.license_url ? (
                    <>
                      {' '}
                      <a
                        href={pack.license_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--gold)' }}
                      >
                        {pack.license || t('contentPacks.licence')}
                        <LuExternalLink size={11} style={{ marginLeft: 3 }} aria-hidden="true" />
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <ConfirmModal
          title={t('contentPacks.confirmUninstallTitle')}
          message={t('contentPacks.confirmUninstall', { name: removing.name })}
          confirmLabel={t('contentPacks.uninstallConfirm')}
          onConfirm={() => uninstall(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
