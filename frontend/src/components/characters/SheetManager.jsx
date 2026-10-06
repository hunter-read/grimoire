import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuFileText, LuBookOpen } from 'react-icons/lu'
import SheetsTab from './SheetsTab'
import RulesetsPanel from './RulesetsPanel'
import SheetCatalogue from './SheetCatalogue'
import {
  scrim,
  modalPanel,
  modalHeader,
  modalBody,
  tabList,
  tabBtn,
  iconBtn,
} from './characterStyles'

const TABS = [
  { key: 'sheets', icon: LuFileText, label: 'characters.manageSheetsTab' },
  { key: 'rulesets', icon: LuBookOpen, label: 'rulesets.title' },
]

/**
 * One place to manage everything a character is built from.
 *
 * Sheets and rulesets were four separate buttons and a route between them,
 * which meant "set up the content for my game" was a hunt. They are one job —
 * a sheet describes a character, a ruleset supplies what it picks from — so
 * they belong behind one button, as two tabs.
 */
export default function SheetManager({ schemas, onChanged, onClose, initialTab = 'sheets' }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState(initialTab)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event) => {
      // Only the top-most layer closes: with the catalogue open over this,
      // Escape should shut the catalogue and leave the manager standing.
      if (event.key === 'Escape' && !browsing) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, browsing])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('characters.manageSheets')}
      style={scrim}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div style={modalPanel}>
        <header style={modalHeader}>
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>{t('characters.manageSheets')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn}>
            <LuX size={18} />
          </button>
        </header>

        <div role="tablist" aria-label={t('characters.manageSheets')} style={tabList}>
          {TABS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              style={tabBtn(tab === key)}
            >
              <Icon size={14} />
              {t(label)}
            </button>
          ))}
        </div>

        <div style={modalBody}>
          {error ? (
            <div role="alert" style={{ color: 'var(--danger)', marginBottom: 12 }}>
              {error}
            </div>
          ) : null}

          {tab === 'sheets' ? (
            <SheetsTab
              schemas={schemas}
              onChanged={onChanged}
              onBrowse={() => setBrowsing(true)}
              setError={setError}
            />
          ) : (
            <RulesetsPanel />
          )}
        </div>
      </div>

      {browsing ? (
        <SheetCatalogue
          onInstalled={onChanged}
          onClose={() => {
            setBrowsing(false)
            // A sheet installed from the catalogue should show in the list
            // behind it without the user closing and reopening the manager.
            onChanged?.()
          }}
        />
      ) : null}
    </div>
  )
}
