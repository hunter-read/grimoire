import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRefreshCw, LuExternalLink } from 'react-icons/lu'
import { content as contentApi, contentAdmin } from '../../api'
import Spinner from '../Spinner'
import { ghostBtn, card } from '../characters/characterStyles'

/**
 * Installed character content packs, and the credit each is published under.
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
  const [packs, setPacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await contentApi.packs()
      setPacks(result.packs || [])
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reload = async () => {
    setReloading(true)
    try {
      const result = await contentAdmin.reloadPacks()
      setPacks(result.packs || [])
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setReloading(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{t('contentPacks.title')}</h3>
        <button onClick={reload} disabled={reloading} style={ghostBtn}>
          <LuRefreshCw size={14} />
          {reloading ? t('contentPacks.reloading') : t('contentPacks.reload')}
        </button>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        {t('contentPacks.help')}
      </p>

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
                <strong>{pack.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  v{pack.version} · {pack.schema_id} ·{' '}
                  {t('contentPacks.entries', { count: pack.entry_count })}
                </span>
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
                        <LuExternalLink size={11} style={{ marginLeft: 3 }} />
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
