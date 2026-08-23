import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck, LuLayers } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'

import api from '../../api'

/**
 * "Switch version" rows for a book's overflow menu.
 *
 * List rows carry only `variant_count`, not the family itself, so the sibling
 * list is fetched the first time the section is expanded rather than on every
 * card render — a shelf of 200 books must not fire 200 requests for a menu
 * nobody opened.
 *
 * Mounted only for a book that actually has other versions (see the guard at
 * the call site), which is also what keeps it clear of callers that render the
 * menu outside a Router.
 */
export default function VariantMenuItems({ book, itemStyle, onPick }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [family, setFamily] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || family || loading) return
    // The detail endpoint returns the whole family from either end, so one
    // request covers both "this is the main entry" and "this is a variant".
    setLoading(true)
    api
      .get(`/books/${book.id}`)
      .then((data) =>
        setFamily([
          { id: data.variant_main_id || data.id, isMain: true },
          ...(data.variants || []).map((v) => ({ ...v, isMain: false })),
        ])
      )
      .catch(() => setFamily([]))
      .finally(() => setLoading(false))
  }, [open, family, loading, book.id])

  const label = (option) => {
    if (option.isMain) return t('variants.mainVersion')
    if (option.label) return option.label
    return t(`variants.kind.${option.kind}`, { defaultValue: option.kind })
  }

  return (
    <>
      <button
        role="menuitem"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        style={itemStyle}
      >
        <LuLayers size={15} aria-hidden="true" />
        {t('variants.switchLabel')}
      </button>
      {open &&
        (loading ? (
          <div style={{ ...itemStyle, opacity: 0.6, cursor: 'default' }}>{t('common.loading')}</div>
        ) : (
          (family || []).map((option) => (
            <button
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === book.id}
              onClick={(e) => {
                e.stopPropagation()
                onPick?.(option.id)
                if (option.id !== book.id) navigate(`/library/book/${option.id}`)
              }}
              style={{ ...itemStyle, paddingLeft: 30, fontSize: 13 }}
            >
              {option.id === book.id ? (
                <LuCheck size={13} aria-hidden="true" />
              ) : (
                <span style={{ width: 13 }} />
              )}
              {label(option)}
            </button>
          ))
        ))}
    </>
  )
}
