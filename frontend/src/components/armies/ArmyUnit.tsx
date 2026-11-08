import { useState } from 'react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import type { Schema } from '../../api'
import ProfileTables from './ProfileTables'
import SourceRef from './SourceRef'
import UnitProgress from './UnitProgress'
import { chip, muted } from './armyStyles'
import { unitTotal } from './armyText'

interface ArmyUnitProps {
  unit: Schema<'RosterUnit'>
  costName: string
  links: Record<string, Schema<'PublicationLinkOut'>>
  depth?: number
  progress?: Schema<'UnitProgress'>
  canEdit?: boolean
  onSaveProgress?: (unitId: string, progress: Schema<'UnitProgress'>) => Promise<void>
}

/**
 * One unit of an army: its count, name, categories and points, opening onto
 * its stat lines, rules, upgrades and - for a top-level unit - its progress.
 * Nested selections (upgrades, models in a unit) render as smaller rows.
 */
export default function ArmyUnit({
  unit,
  costName,
  links,
  depth = 0,
  progress,
  canEdit = false,
  onSaveProgress,
}: ArmyUnitProps) {
  const [open, setOpen] = useState(false)
  const unitId = unit.id
  const points = unitTotal(unit, costName)
  const rules = unit.rules ?? []
  const children = unit.children ?? []
  const hasDetail =
    depth === 0 || !!unit.profiles?.length || rules.length > 0 || children.length > 0
  const categories = [
    unit.primary_category,
    ...(unit.categories ?? []).filter((c) => c !== unit.primary_category),
  ].filter((c): c is string => !!c)

  return (
    <div
      style={{
        borderTop: depth ? '1px dashed var(--border)' : 'none',
        padding: depth ? '6px 0 6px 14px' : 0,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'inherit',
          padding: 0,
          textAlign: 'left',
          cursor: hasDetail ? 'pointer' : 'default',
          fontSize: depth ? 13 : 15,
        }}
      >
        {!hasDetail ? (
          <span style={{ width: 14 }} />
        ) : open ? (
          <LuChevronDown size={14} aria-hidden="true" />
        ) : (
          <LuChevronRight size={14} aria-hidden="true" />
        )}
        <span style={{ fontWeight: depth ? 400 : 600, flex: 1 }}>
          {(unit.number ?? 1) > 1 && `${unit.number}× `}
          {unit.name}
        </span>
        {depth === 0 &&
          categories.slice(0, 3).map((c) => (
            <span key={c} style={chip}>
              {c}
            </span>
          ))}
        {points > 0 && (
          <span style={{ ...muted, whiteSpace: 'nowrap' }}>
            {points} {costName}
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: '8px 0 4px 22px', display: 'grid', gap: 10 }}>
          <SourceRef publication={unit.publication} page={unit.page} links={links} />
          <ProfileTables profiles={unit.profiles} />
          {rules.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              {rules.map((rule, i) => (
                <li key={`${rule.name}-${i}`} style={{ fontSize: 13 }}>
                  <strong>{rule.name}</strong>{' '}
                  <SourceRef publication={rule.publication} page={rule.page} links={links} />
                  {rule.description && <div style={muted}>{rule.description}</div>}
                </li>
              ))}
            </ul>
          )}
          {unit.notes && <div style={muted}>{unit.notes}</div>}
          {children.map((child, i) => (
            <ArmyUnit
              key={child.id || `${child.name}-${i}`}
              unit={child}
              costName={costName}
              links={links}
              depth={depth + 1}
            />
          ))}
          {depth === 0 && onSaveProgress && unitId && (
            <UnitProgress
              progress={progress}
              canEdit={canEdit}
              onSave={(next) => onSaveProgress(unitId, next)}
            />
          )}
        </div>
      )}
    </div>
  )
}
