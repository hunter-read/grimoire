import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import type { Schema } from '../../api'
import { card, errorText, input, primaryBtn, secondaryBtn } from './armyStyles'
import { errorMessage } from './armyText'

type ManualUnit = Schema<'ManualUnitIn'>

interface Row {
  id: string
  name: string
  number: string
  points: string
  category: string
  notes: string
}

const blank = (): Row => ({ id: '', name: '', number: '1', points: '0', category: '', notes: '' })

function fromUnit(unit: Schema<'RosterUnit'>): Row {
  return {
    id: unit.id ?? '',
    name: unit.name ?? '',
    number: String(unit.number || 1),
    points: String((unit.costs ?? []).reduce((sum, c) => sum + (c.value ?? 0), 0)),
    category: unit.primary_category ?? '',
    notes: unit.notes ?? '',
  }
}

interface ManualUnitsEditorProps {
  units: Schema<'RosterUnit'>[]
  onSave: (units: ManualUnit[]) => Promise<void>
  onCancel: () => void
}

/**
 * Edit a hand-built army's units: name, model count, points and a category.
 * Saving replaces the list; ids are kept so each unit's progress stays with it.
 */
export default function ManualUnitsEditor({ units, onSave, onCancel }: ManualUnitsEditorProps) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>(() => (units.length ? units.map(fromUnit) : [blank()]))
  const [error, setError] = useState('')

  const set = (i: number, field: keyof Row, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [field]: value } : row)))

  const save = async () => {
    setError('')
    try {
      await onSave(
        rows
          .filter((r) => r.name.trim())
          .map((r) => ({
            ...(r.id ? { id: r.id } : {}),
            name: r.name.trim(),
            number: Math.max(1, Math.floor(Number(r.number) || 1)),
            points: Math.max(0, Math.floor(Number(r.points) || 0)),
            category: r.category.trim() || null,
            categories: r.category.trim() ? [r.category.trim()] : [],
            notes: r.notes || null,
          }))
      )
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div style={{ ...card, display: 'grid', gap: 8 }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...input, flex: 3, minWidth: 160 }}
            placeholder={t('armies.unitName')}
            aria-label={t('armies.unitName')}
            value={row.name}
            onChange={(e) => set(i, 'name', e.target.value)}
          />
          <input
            style={{ ...input, width: 70 }}
            type="number"
            min="1"
            aria-label={t('armies.models')}
            title={t('armies.models')}
            value={row.number}
            onChange={(e) => set(i, 'number', e.target.value)}
          />
          <input
            style={{ ...input, width: 90 }}
            type="number"
            min="0"
            aria-label={t('armies.unitPoints')}
            title={t('armies.unitPoints')}
            value={row.points}
            onChange={(e) => set(i, 'points', e.target.value)}
          />
          <input
            style={{ ...input, flex: 1, minWidth: 120 }}
            placeholder={t('armies.category')}
            aria-label={t('armies.category')}
            value={row.category}
            onChange={(e) => set(i, 'category', e.target.value)}
          />
          <button
            type="button"
            style={secondaryBtn}
            onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
            aria-label={t('armies.removeUnit')}
            title={t('armies.removeUnit')}
          >
            <LuTrash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={secondaryBtn} onClick={() => setRows((r) => [...r, blank()])}>
          <LuPlus size={14} aria-hidden="true" /> {t('armies.addUnit')}
        </button>
        <button type="button" style={primaryBtn} onClick={() => void save()}>
          {t('common.save')}
        </button>
        <button type="button" style={secondaryBtn} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </div>
  )
}
