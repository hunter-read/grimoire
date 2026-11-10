import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { armies as armiesApi } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { input, label } from './armyStyles'

interface GameFactionFieldsProps {
  systemId: string
  factionId?: string
  onChange: (systemId: string, factionId: string) => void
  /** Leagues are for a game, not a faction: leave the faction picker out. */
  withFaction?: boolean
}

interface GameOption {
  id: string
  name: string
}

interface FactionOption extends GameOption {
  depth: number
}

/**
 * Pick a wargame from the library's armory and, optionally, one of its
 * factions. Changing the game clears the faction, which belongs to one game.
 * A league's guest has no library: they pick from their leagues' games.
 */
export default function GameFactionFields({
  systemId,
  factionId = '',
  onChange,
  withFaction = true,
}: GameFactionFieldsProps) {
  const { t } = useTranslation()
  const isGuest = useAuth()?.user?.role === 'guest'
  const [systems, setSystems] = useState<GameOption[]>([])
  const [factions, setFactions] = useState<FactionOption[]>([])

  useEffect(() => {
    const load: Promise<GameOption[]> = isGuest ? armiesApi.games() : armiesApi.systems()
    load.then(setSystems).catch(() => setSystems([]))
  }, [isGuest])

  useEffect(() => {
    if (!withFaction || !systemId) return undefined
    let cancelled = false
    const load = isGuest ? armiesApi.gameFactions(systemId) : armiesApi.factions(systemId)
    load
      .then((res) => {
        if (!cancelled) setFactions(res.factions)
      })
      .catch(() => {
        if (!cancelled) setFactions([])
      })
    return () => {
      cancelled = true
    }
  }, [systemId, withFaction, isGuest])

  return (
    <>
      <label style={label}>
        {t('armies.game')}
        <select
          style={{ ...input, minWidth: 200 }}
          value={systemId}
          onChange={(e) => onChange(e.target.value, '')}
        >
          <option value="">{t('armies.noGame')}</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {withFaction && systemId && factions.length > 0 && (
        <label style={label}>
          {t('armies.faction')}
          <select
            style={{ ...input, minWidth: 180 }}
            value={factionId}
            onChange={(e) => onChange(systemId, e.target.value)}
          >
            <option value="">{t('armies.noFaction')}</option>
            {factions.map((f) => (
              <option key={f.id} value={f.id}>
                {`${'  '.repeat(f.depth)}${f.name}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}
