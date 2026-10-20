import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus } from 'react-icons/lu'
import { naming } from '../../api'
import Spinner from '../Spinner'
import VariantRuleRow, { type VariantRule } from './VariantRuleRow'
import { buttonStyle, failure, hintStyle } from './filenameRulesStyles'

const blank = (): VariantRule => ({
  match: 'token',
  value: '',
  kind: null,
  label: '',
  collection: null,
})

/**
 * The library's own filename markers for variant kinds and labels (issue #569).
 *
 * Edited as one list and saved whole: the order is the meaning (the first rule
 * that tells two copies apart wins), so a per-row save would let the list sit
 * half-reordered on the server.
 */
export default function VariantRulesSection() {
  const { t } = useTranslation()
  const [rules, setRules] = useState<VariantRule[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // Stable React keys for rows that have no id of their own, so reordering
  // moves a row's inputs with it instead of re-pairing them by position.
  const keys = useRef<number[]>([])
  const nextKey = useRef(0)

  useEffect(() => {
    naming
      .variantRules()
      .then((body) => {
        keys.current = body.rules.map(() => nextKey.current++)
        setRules(body.rules)
      })
      .catch((err: unknown) => {
        setRules([])
        setMessage({ tone: 'error', text: failure(err) || t('filenameRules.variant.loadFailed') })
      })
  }, [t])

  if (rules === null) return <Spinner size={20} />

  const update = (next: VariantRule[]) => {
    setRules(next)
    setDirty(true)
    setMessage(null)
  }

  const change = (i: number, rule: VariantRule) => update(rules.map((r, j) => (j === i ? rule : r)))

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta
    if (j < 0 || j >= rules.length) return
    const next = [...rules]
    ;[next[i], next[j]] = [next[j], next[i]]
    const k = keys.current
    ;[k[i], k[j]] = [k[j], k[i]]
    update(next)
  }

  const remove = (i: number) => {
    keys.current = keys.current.filter((_, j) => j !== i)
    update(rules.filter((_, j) => j !== i))
  }

  const add = () => {
    keys.current = [...keys.current, nextKey.current++]
    update([...rules, blank()])
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const body = await naming.saveVariantRules(rules)
      keys.current = body.rules.map(() => nextKey.current++)
      setRules(body.rules)
      setDirty(false)
      setMessage({ tone: 'ok', text: t('filenameRules.variant.saved') })
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err) || t('filenameRules.variant.saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p style={{ ...hintStyle, marginBottom: 12 }}>{t('filenameRules.variant.orderHint')}</p>

      {rules.length === 0 ? (
        <p style={hintStyle}>{t('filenameRules.variant.empty')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {rules.map((rule, i) => (
            <VariantRuleRow
              key={keys.current[i]}
              rule={rule}
              index={i}
              count={rules.length}
              onChange={(r) => change(i, r)}
              onMove={(delta) => move(i, delta)}
              onRemove={() => remove(i)}
            />
          ))}
        </div>
      )}

      {message && (
        <div
          role={message.tone === 'error' ? 'alert' : 'status'}
          style={{
            marginTop: 10,
            fontSize: 13,
            color: message.tone === 'error' ? 'var(--danger)' : 'var(--green)',
          }}
        >
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={add} style={buttonStyle()}>
          <LuPlus size={13} /> {t('filenameRules.variant.add')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          style={buttonStyle(true, busy || !dirty)}
        >
          {busy && <Spinner size={13} />}
          {t('filenameRules.variant.save')}
        </button>
      </div>
    </div>
  )
}
