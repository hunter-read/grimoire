import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuPencil, LuShield, LuTrash2 } from 'react-icons/lu'
import { armies as armiesApi, type BodyOf, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import ArmyDetailsForm from '../components/armies/ArmyDetailsForm'
import ArmyUnit from '../components/armies/ArmyUnit'
import ManualUnitsEditor from '../components/armies/ManualUnitsEditor'
import PublicationLinksPanel from '../components/armies/PublicationLinksPanel'
import {
  card,
  dangerBtn,
  errorText,
  header,
  muted,
  page,
  secondaryBtn,
  sectionTitle,
  title,
} from '../components/armies/armyStyles'
import { errorMessage, flattenForces, overLimit } from '../components/armies/armyText'
import usePageTitle from '../hooks/usePageTitle'

/**
 * One army: its forces and units with stat lines, rules and upgrades, each
 * unit's league progress, and the books its rules come from. The owner can
 * edit its details, edit a hand-built list, export it, or delete it.
 */
export default function ArmyDetailView() {
  const { armyId = '' } = useParams()
  const { t } = useTranslation()
  const user = useAuth()?.user
  const navigate = useNavigate()
  const [army, setArmy] = useState<Schema<'ArmyDetail'> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editingUnits, setEditingUnits] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  usePageTitle(army?.name)

  const load = useCallback(
    () =>
      armiesApi
        .get(armyId)
        .then(setArmy)
        .catch((e: unknown) => setLoadError(errorMessage(e, t('armies.loadFailed')))),
    [armyId, t]
  )

  useEffect(() => {
    void load()
  }, [load])

  if (loadError) return <p style={{ ...page, color: 'var(--danger)' }}>{loadError}</p>
  if (!army) return <Spinner size={28} />

  const canLink = user?.role === 'admin' || user?.role === 'gm'
  const forces = flattenForces(army.data?.forces)
  const links = army.publication_links ?? {}
  const costName = army.cost_name || 'pts'
  const over = overLimit(army)

  const run = async (action: () => Promise<void>) => {
    setActionError('')
    try {
      await action()
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }
  const saveDetails = async (patch: BodyOf<'/armies/{army_id}', 'patch'>) => {
    setArmy(await armiesApi.update(army.id, patch))
    setEditing(false)
  }
  const saveUnits = async (units: Schema<'ManualUnitIn'>[]) => {
    setArmy(await armiesApi.update(army.id, { units }))
    setEditingUnits(false)
  }
  const saveProgress = async (unitId: string, progress: Schema<'UnitProgress'>) => {
    const saved = await armiesApi.setProgress(army.id, unitId, progress)
    setArmy((a) => (a ? { ...a, progress: { ...a.progress, [unitId]: saved } } : a))
  }
  const remove = async () => {
    await armiesApi.remove(army.id)
    void navigate('/armies')
  }

  return (
    <div className="fade-in" style={page}>
      <Link to="/armies" style={{ ...muted, display: 'inline-flex', gap: 6, marginBottom: 12 }}>
        <LuArrowLeft size={14} aria-hidden="true" /> {t('armies.back')}
      </Link>
      <div style={header}>
        <div>
          <h1 style={title}>
            <LuShield size={20} color="var(--gold)" aria-hidden="true" /> {army.name}
          </h1>
          <div style={{ ...muted, marginTop: 4 }}>
            {[army.game_system_name || army.system_name, army.faction?.name]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={secondaryBtn}
            onClick={() => void run(() => armiesApi.download(army.id, 'text', `${army.name}.txt`))}
          >
            <LuDownload size={14} aria-hidden="true" /> {t('armies.exportText')}
          </button>
          {army.source === 'battlescribe' && (
            <button
              type="button"
              style={secondaryBtn}
              onClick={() =>
                void run(() =>
                  armiesApi.download(army.id, 'roster', army.source_filename || `${army.name}.rosz`)
                )
              }
            >
              <LuDownload size={14} aria-hidden="true" /> {t('armies.exportRoster')}
            </button>
          )}
          {army.can_edit && (
            <>
              <button type="button" style={secondaryBtn} onClick={() => setEditing(true)}>
                <LuPencil size={14} aria-hidden="true" /> {t('armies.edit')}
              </button>
              {confirmDelete ? (
                <>
                  <button type="button" style={dangerBtn} onClick={() => void run(remove)}>
                    {t('armies.confirmDelete')}
                  </button>
                  <button
                    type="button"
                    style={secondaryBtn}
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button type="button" style={dangerBtn} onClick={() => setConfirmDelete(true)}>
                  <LuTrash2 size={14} aria-hidden="true" /> {t('armies.delete')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {actionError && (
        <p role="alert" style={{ ...errorText, marginBottom: 12 }}>
          {actionError}
        </p>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{ ...card, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}
        >
          <strong style={{ fontSize: 20, color: over ? 'var(--danger)' : 'var(--text)' }}>
            {t('armies.points', {
              points: army.points ?? 0,
              limit: army.points_limit || '-',
              cost: costName,
            })}
          </strong>
          {over && <span style={{ color: 'var(--danger)' }}>{t('armies.overLimit')}</span>}
          {army.notes && !editing && <span style={muted}>{army.notes}</span>}
        </div>

        {editing && (
          <ArmyDetailsForm army={army} onSave={saveDetails} onCancel={() => setEditing(false)} />
        )}

        {editingUnits ? (
          <ManualUnitsEditor
            units={forces.flatMap((f) => f.units ?? [])}
            onSave={saveUnits}
            onCancel={() => setEditingUnits(false)}
          />
        ) : (
          forces.map((force, i) => (
            <section key={force.id || i} style={card}>
              {(force.name || force.catalogue) && (
                <h2 style={{ ...sectionTitle, margin: '0 0 12px' }}>
                  {[force.name, force.catalogue].filter(Boolean).join(' · ')}
                </h2>
              )}
              <div style={{ display: 'grid', gap: 12 }}>
                {(force.units ?? []).map((unit, j) => (
                  <ArmyUnit
                    key={unit.id || j}
                    unit={unit}
                    costName={costName}
                    links={links}
                    progress={unit.id ? army.progress?.[unit.id] : undefined}
                    canEdit={army.can_edit}
                    onSaveProgress={saveProgress}
                  />
                ))}
                {!force.units?.length && <p style={muted}>{t('armies.noUnits')}</p>}
              </div>
            </section>
          ))
        )}

        {army.can_edit && army.source === 'manual' && !editingUnits && (
          <div>
            <button type="button" style={secondaryBtn} onClick={() => setEditingUnits(true)}>
              <LuPencil size={14} aria-hidden="true" /> {t('armies.editUnits')}
            </button>
          </div>
        )}

        {canLink && <PublicationLinksPanel army={army} onChanged={() => void load()} />}
      </div>
    </div>
  )
}
