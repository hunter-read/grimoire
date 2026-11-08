import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { errorText, input, label, muted, primaryBtn, row } from './armyStyles'
import { errorMessage } from './armyText'

type Progress = Schema<'UnitProgress'>

interface UnitProgressProps {
  progress?: Progress
  canEdit: boolean
  onSave: (progress: Progress) => Promise<void>
}

/**
 * A unit's progress over a league: experience, honours earned, and notes.
 * Editable by the army's owner; read-only for everyone else.
 */
export default function UnitProgress({ progress = {}, canEdit, onSave }: UnitProgressProps) {
  const { t } = useTranslation()
  const [experience, setExperience] = useState(String(progress.experience ?? 0))
  const [honours, setHonours] = useState((progress.honours ?? []).join(', '))
  const [notes, setNotes] = useState(progress.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!canEdit) {
    if (!progress.experience && !progress.honours?.length && !progress.notes) return null
    return (
      <div style={muted}>
        {t('armies.progress.summary', { experience: progress.experience ?? 0 })}
        {progress.honours?.length ? ` · ${progress.honours.join(', ')}` : ''}
        {progress.notes && <div>{progress.notes}</div>}
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave({
        experience: Math.max(0, Math.floor(Number(experience) || 0)),
        honours: honours
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
        notes,
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
        {t('armies.progress.title')}
      </legend>
      <div style={row}>
        <label style={label}>
          {t('armies.progress.experience')}
          <input
            style={{ ...input, width: 80 }}
            type="number"
            min="0"
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
          />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 180 }}>
          {t('armies.progress.honours')}
          <input style={input} value={honours} onChange={(e) => setHonours(e.target.value)} />
        </label>
        <label style={{ ...label, flex: 2, minWidth: 200 }}>
          {t('armies.progress.notes')}
          <input style={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="button" style={primaryBtn} onClick={() => void save()} disabled={saving}>
          {t('common.save')}
        </button>
      </div>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </fieldset>
  )
}
