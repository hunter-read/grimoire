import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuShield, LuPlus, LuSwords, LuFlag } from 'react-icons/lu'
import api from '../api'

/**
 * Army Roster — a Codex-mode-only mockup for wargaming force organization.
 *
 * This is a front-end prototype: it pulls the real library's game systems (so
 * the page feels populated by whatever the user actually has) and treats each
 * as a "faction" you could build a roster under. Rosters themselves are local,
 * illustrative sample data — there is no backend for them yet. The goal is to
 * show what a wargaming-focused surface could look like on top of the existing
 * Grimoire library.
 */

const SAMPLE_ROSTERS = [
  { id: 1, name: 'Strike Force Ultima', points: 2000, units: 14, updated: '2 days ago' },
  { id: 2, name: 'Vanguard Detachment', points: 1000, units: 8, updated: '1 week ago' },
  { id: 3, name: 'Siege Company', points: 3000, units: 22, updated: '3 weeks ago' },
]

export default function ArmyRosterView() {
  const { t } = useTranslation()
  const [systems, setSystems] = useState(null)

  useEffect(() => {
    api
      .get('/systems')
      .then((data) => setSystems(Array.isArray(data) ? data : []))
      .catch(() => setSystems([]))
  }, [])

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <LuShield size={20} color="var(--gold)" /> {t('codex.rosters.title')}
        </h2>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--gold)',
            color: 'var(--bg-deep)',
            border: 'none',
            borderRadius: 8,
            padding: '9px 16px',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <LuPlus size={16} /> {t('codex.rosters.new')}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
        {t('codex.rosters.subtitle')}
      </p>

      {/* Existing rosters (sample) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 36,
        }}
      >
        {SAMPLE_ROSTERS.map((r) => (
          <div
            key={r.id}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <LuFlag size={16} color="var(--gold)" />
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{r.name}</span>
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-dim)' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--gold)' }}>
                  {r.points}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>{t('codex.rosters.points')}</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{r.units}</div>
                <div style={{ color: 'var(--text-muted)' }}>{t('codex.rosters.units')}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('codex.rosters.updated', { when: r.updated })}
            </div>
          </div>
        ))}
      </div>

      {/* Factions drawn from the real library's game systems */}
      <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <LuSwords size={16} /> {t('codex.rosters.factions')}
      </h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        {t('codex.rosters.factionsHint')}
      </p>
      {systems === null ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{t('common.loading')}</div>
      ) : systems.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          {t('codex.rosters.noFactions')}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {systems.map((s) => (
            <button
              key={s.id ?? s.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '12px 14px',
                color: 'var(--text)',
                fontSize: 14,
                fontWeight: 500,
                textAlign: 'left',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.name}
              </span>
              <LuPlus size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
