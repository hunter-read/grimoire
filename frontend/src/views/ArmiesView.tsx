import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuShield, LuUpload } from 'react-icons/lu'
import { armies as armiesApi, type BodyOf, type Schema } from '../api'
import Spinner from '../components/Spinner'
import ArmyCard from '../components/armies/ArmyCard'
import NewArmyForm from '../components/armies/NewArmyForm'
import {
  errorText,
  grid,
  header,
  muted,
  page,
  primaryBtn,
  secondaryBtn,
  title,
} from '../components/armies/armyStyles'
import { errorMessage } from '../components/armies/armyText'
import usePageTitle from '../hooks/usePageTitle'

/**
 * Your armies. Import a BattleScribe or New Recruit roster, or build a list by
 * hand; each opens on its own page.
 */
export default function ArmiesView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [list, setList] = useState<Schema<'ArmySummary'>[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  usePageTitle(t('armies.title'))

  useEffect(() => {
    armiesApi
      .list()
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e, t('armies.loadFailed'))))
  }, [t])

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const army = await armiesApi.importRoster(file)
      void navigate(`/armies/${army.id}`)
    } catch (err) {
      setError(errorMessage(err, t('armies.importFailed')))
    } finally {
      setBusy(false)
    }
  }

  const create = async (data: BodyOf<'/armies', 'post'>) => {
    const army = await armiesApi.create(data)
    void navigate(`/armies/${army.id}`)
  }

  return (
    <div className="fade-in" style={page}>
      <div style={header}>
        <h1 style={title}>
          <LuShield size={20} color="var(--gold)" aria-hidden="true" /> {t('armies.title')}
        </h1>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={secondaryBtn}
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            title={t('armies.importHint')}
          >
            {busy ? <Spinner size={13} /> : <LuUpload size={14} aria-hidden="true" />}
            {t('armies.import')}
          </button>
          <button type="button" style={primaryBtn} onClick={() => setCreating(true)}>
            <LuPlus size={14} aria-hidden="true" /> {t('armies.new')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".ros,.rosz"
            onChange={(e) => void importFile(e)}
            data-testid="roster-input"
            aria-label={t('armies.import')}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {error && (
        <p role="alert" style={{ ...errorText, fontSize: 14, marginBottom: 16 }}>
          {error}
        </p>
      )}
      {creating && (
        <div style={{ marginBottom: 20 }}>
          <NewArmyForm onCreate={create} onCancel={() => setCreating(false)} />
        </div>
      )}

      {list === null ? (
        !error && <Spinner size={24} />
      ) : list.length ? (
        <div style={grid}>
          {list.map((army) => (
            <ArmyCard key={army.id} army={army} />
          ))}
        </div>
      ) : (
        <p style={muted}>{t('armies.empty')}</p>
      )}
    </div>
  )
}
