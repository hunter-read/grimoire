import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { AVAILABLE_LANGUAGES } from '../../i18n'
import { LuCircleCheck } from 'react-icons/lu'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'

function SegmentedControl({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
      {options.map(({ value: v, label }, idx) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            padding: '7px 18px', fontSize: 14, cursor: 'pointer',
            border: 'none',
            borderRight: idx < options.length - 1 ? '1px solid var(--border)' : 'none',
            background: value === v ? 'var(--bg-card-hover)' : 'var(--bg-card)',
            color: value === v ? 'var(--gold)' : 'var(--text-dim)',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function ReaderSection() {
  const { t } = useTranslation()
  const prefs = getUserPrefs()
  const [readerMode, setReaderMode] = useState(prefs.readerMode || 'default')
  const [wheelNav,   setWheelNav]   = useState(prefs.wheelNav !== false)
  const [saved,      setSaved]      = useState(false)

  const READER_MODE_OPTIONS = [
    { value: 'default', label: t('userSettings.reader.perBook') },
    { value: 'page',    label: t('userSettings.reader.page')    },
    { value: 'spread',  label: t('userSettings.reader.spread')  },
    { value: 'pdf',     label: t('userSettings.reader.pdf')     },
  ]

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const handleMode  = (v) => { setReaderMode(v); saveUserPref('readerMode', v); flash() }
  const handleWheel = () => { const next = !wheelNav; setWheelNav(next); saveUserPref('wheelNav', next); flash() }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
        {t('userSettings.reader.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.6 }}>
        {t('userSettings.reader.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>{t('userSettings.reader.defaultViewMode')}</div>
          <SegmentedControl options={READER_MODE_OPTIONS} value={readerMode} onChange={handleMode} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('userSettings.reader.viewModeHint')}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            role="switch"
            aria-checked={wheelNav}
            onClick={handleWheel}
            style={{
              position: 'relative', width: 44, height: 24, borderRadius: 12,
              border: 'none', cursor: 'pointer', flexShrink: 0,
              background: wheelNav ? 'var(--gold-dim)' : 'var(--bg-card)',
              outline: '1px solid var(--border)', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, borderRadius: '50%',
              width: 18, height: 18,
              background: wheelNav ? 'var(--bg-deep)' : 'var(--text-muted)',
              left: wheelNav ? 23 : 3, transition: 'left 0.2s',
            }} />
          </button>
          <div>
            <div style={{ fontSize: 14, color: 'var(--text)' }}>{t('userSettings.reader.scrollWheelNav')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {t('userSettings.reader.scrollWheelNavHint')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function LanguageSection() {
  const [lang, setLang] = useState(localStorage.getItem('grimoire:language') || 'en')
  const [saved, setSaved] = useState(false)


  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const handleLang = (v) => {
    setLang(v)
    localStorage.setItem('grimoire:language', v)
    i18n.changeLanguage(v)
    flash()
  }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
        Language / Sprache
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.6 }}>
        Choose the display language for the interface.
      </p>
      <SegmentedControl options={AVAILABLE_LANGUAGES} value={lang} onChange={handleLang} />
    </div>
  )
}

export function LibrarySection() {
  const { t } = useTranslation()
  const prefs = getUserPrefs()
  const [sort,     setSort]     = useState(prefs.librarySort || 'az')
  const [cardSize, setCardSize] = useState(prefs.cardSize    || 'comfortable')
  const [saved,    setSaved]    = useState(false)

  const SORT_OPTIONS = [
    { value: 'az', label: 'A → Z' },
    { value: 'za', label: 'Z → A' },
  ]

  const CARD_SIZE_OPTIONS = [
    { value: 'comfortable', label: t('userSettings.library.comfortable') },
    { value: 'compact',     label: t('userSettings.library.compact')     },
  ]

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const handleSort     = (v) => { setSort(v);     saveUserPref('librarySort', v);  flash() }
  const handleCardSize = (v) => { setCardSize(v); saveUserPref('cardSize', v);     flash() }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
        {t('userSettings.library.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24, lineHeight: 1.6 }}>
        {t('userSettings.library.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>{t('userSettings.library.sortOrder')}</div>
          <SegmentedControl options={SORT_OPTIONS} value={sort} onChange={handleSort} />
        </div>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>{t('userSettings.library.cardSize')}</div>
          <SegmentedControl options={CARD_SIZE_OPTIONS} value={cardSize} onChange={handleCardSize} />
        </div>
      </div>
    </div>
  )
}
