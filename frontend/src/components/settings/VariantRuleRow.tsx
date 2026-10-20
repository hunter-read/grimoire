import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowDown, LuArrowUp, LuTrash2 } from 'react-icons/lu'
import type { Schema } from '../../api'
import { VARIANT_KINDS, kindsFor } from '../../constants/variantKinds'
import { iconButtonStyle, inputStyle } from './filenameRulesStyles'

export type VariantRule = Schema<'VariantRule'>

export const COLLECTIONS = ['book', 'map', 'token', 'audio', 'model'] as const
export const MATCH_TYPES = ['token', 'prefix', 'suffix'] as const

interface Props {
  rule: VariantRule
  index: number
  count: number
  onChange: (rule: VariantRule) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}

const field: CSSProperties = { ...inputStyle, padding: '6px 8px' }

/**
 * One filename rule: what to match, and the kind and/or label it implies.
 *
 * The kind list follows the collection, as everywhere else variants are
 * described: a rule scoped to tokens cannot offer "gridless". Changing the
 * collection to one that does not accept the current kind clears the kind
 * rather than leaving a rule the server would refuse.
 */
export default function VariantRuleRow({ rule, index, count, onChange, onMove, onRemove }: Props) {
  const { t } = useTranslation()
  const kinds: string[] = rule.collection ? kindsFor(rule.collection) : VARIANT_KINDS
  const n = index + 1

  const setCollection = (value: string) => {
    const collection = value || null
    const allowed: string[] = collection ? kindsFor(collection) : VARIANT_KINDS
    onChange({
      ...rule,
      collection,
      kind: rule.kind && allowed.includes(rule.kind) ? rule.kind : null,
    })
  }

  return (
    <div
      role="group"
      aria-label={t('filenameRules.variant.ruleLabel', { n })}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr)) auto',
        gap: 6,
        alignItems: 'center',
        padding: 8,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-card)',
      }}
    >
      <select
        value={rule.match}
        onChange={(e) => onChange({ ...rule, match: e.target.value as VariantRule['match'] })}
        aria-label={t('filenameRules.variant.match')}
        style={field}
      >
        {MATCH_TYPES.map((m) => (
          <option key={m} value={m}>
            {t(`filenameRules.variant.matchType.${m}`)}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={rule.value}
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
        placeholder={t('filenameRules.variant.valuePlaceholder')}
        aria-label={t('filenameRules.variant.value')}
        maxLength={100}
        spellCheck={false}
        style={field}
      />
      <select
        value={rule.kind ?? ''}
        onChange={(e) => onChange({ ...rule, kind: e.target.value || null })}
        aria-label={t('filenameRules.variant.kind')}
        style={field}
      >
        <option value="">{t('filenameRules.variant.anyKind')}</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`variants.kind.${k}`)}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={rule.label ?? ''}
        onChange={(e) => onChange({ ...rule, label: e.target.value })}
        placeholder={t('filenameRules.variant.labelPlaceholder')}
        aria-label={t('filenameRules.variant.label')}
        maxLength={100}
        style={field}
      />
      <select
        value={rule.collection ?? ''}
        onChange={(e) => setCollection(e.target.value)}
        aria-label={t('filenameRules.variant.collection')}
        style={field}
      >
        <option value="">{t('filenameRules.variant.allCollections')}</option>
        {COLLECTIONS.map((c) => (
          <option key={c} value={c}>
            {t(`filenameRules.collection.${c}`)}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={t('filenameRules.variant.moveUp', { n })}
          style={{ ...iconButtonStyle, opacity: index === 0 ? 0.35 : 1 }}
        >
          <LuArrowUp size={14} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
          aria-label={t('filenameRules.variant.moveDown', { n })}
          style={{ ...iconButtonStyle, opacity: index === count - 1 ? 0.35 : 1 }}
        >
          <LuArrowDown size={14} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('filenameRules.variant.remove', { n })}
          style={iconButtonStyle}
        >
          <LuTrash2 size={14} />
        </button>
      </div>
    </div>
  )
}
