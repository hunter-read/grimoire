import { useTranslation } from 'react-i18next'
import { LuSwords, LuPlus, LuMapPin, LuClock, LuTrophy, LuCircleDot } from 'react-icons/lu'

/**
 * Battles — a Codex-mode-only mockup for planning and tracking wargaming games.
 *
 * Front-end prototype only: the battles below are illustrative sample data with
 * no backend behind them yet. It demonstrates how a wargaming-focused activity
 * feed (scheduled games, results, scenarios) could sit alongside the existing
 * Grimoire library and audio.
 */

const SAMPLE_BATTLES = [
  {
    id: 1,
    name: 'The Broken Spire',
    scenario: 'Take and Hold',
    when: 'Tomorrow, 19:00',
    place: 'Table 3 — Urban',
    points: 2000,
    status: 'scheduled',
    forces: ['Strike Force Ultima', 'The Ashen Legion'],
  },
  {
    id: 2,
    name: 'Ford at Gray River',
    scenario: 'Breakthrough',
    when: 'Sat, 14:00',
    place: 'Table 1 — Fields',
    points: 1500,
    status: 'scheduled',
    forces: ['Vanguard Detachment', 'Ironhold Wardens'],
  },
]

const SAMPLE_RESULTS = [
  { id: 3, name: 'Siege of Karn', result: 'Victory', score: '38 – 25', when: 'Last Sunday' },
  { id: 4, name: 'Dust Basin Skirmish', result: 'Defeat', score: '19 – 41', when: '2 weeks ago' },
  { id: 5, name: 'Nightfall Assault', result: 'Draw', score: '30 – 30', when: '3 weeks ago' },
]

const resultColor = (r) =>
  r === 'Victory' ? 'var(--green)' : r === 'Defeat' ? 'var(--red)' : 'var(--text-dim)'

export default function BattlesView() {
  const { t } = useTranslation()

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
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
          style={{ fontSize: 22, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <LuSwords size={20} color="var(--gold)" /> {t('codex.battles.title')}
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
          <LuPlus size={16} /> {t('codex.battles.new')}
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
        {t('codex.battles.subtitle')}
      </p>

      <h3 style={{ fontSize: 16, marginBottom: 14 }}>{t('codex.battles.upcoming')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 36 }}>
        {SAMPLE_BATTLES.map((b) => (
          <div
            key={b.id}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--gold)',
              borderRadius: 10,
              padding: 18,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)' }}>{b.name}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--gold)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {b.points} {t('codex.rosters.points')}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 18,
                flexWrap: 'wrap',
                margin: '10px 0',
                fontSize: 13,
                color: 'var(--text-dim)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LuTrophy size={14} /> {b.scenario}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LuClock size={14} /> {b.when}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <LuMapPin size={14} /> {b.place}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
              }}
            >
              <span>{b.forces[0]}</span>
              <span style={{ color: 'var(--red)', fontWeight: 700 }}>{t('codex.battles.vs')}</span>
              <span>{b.forces[1]}</span>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 16, marginBottom: 14 }}>{t('codex.battles.recent')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SAMPLE_RESULTS.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LuCircleDot size={14} color={resultColor(r.result)} />
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{r.name}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text-dim)' }}>
                {r.score}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: resultColor(r.result),
                  minWidth: 58,
                  textAlign: 'right',
                }}
              >
                {r.result}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
