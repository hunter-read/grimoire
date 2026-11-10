import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuBed,
  LuChevronLeft,
  LuClapperboard,
  LuCopy,
  LuDownload,
  LuFlagTriangleRight,
  LuLayoutGrid,
  LuPackage,
  LuPlus,
  LuUpload,
} from 'react-icons/lu'
import { campaigns, gmScreen, type Schema } from '../api'
import Spinner from '../components/Spinner'
import { emptyState, ghostBtn, goldBtn } from '../components/characters/characterStyles'
import CopyBoardDialog from '../components/gmScreen/CopyBoardDialog'
import GmBoard from '../components/gmScreen/GmBoard'
import GmMenu from '../components/gmScreen/GmMenu'
import GmPanel from '../components/gmScreen/GmPanel'
import PresetDialog from '../components/gmScreen/PresetDialog'
import { GmScreenContext } from '../components/gmScreen/gmScreenContext'
import { STARTER_BOARD } from '../components/gmScreen/kinds'
import { PANEL_KINDS, type PanelKind } from '../components/gmScreen/types'
import useGmScreen from '../components/gmScreen/useGmScreen'
import { useAuth } from '../context/AuthContext'
import usePageTitle from '../hooks/usePageTitle'

type Dialog = 'copy' | 'presets' | null
type Scope = 'scene' | 'session' | 'rest'

const RESET_ICONS: Record<Scope, typeof LuBed> = {
  scene: LuClapperboard,
  session: LuFlagTriangleRight,
  rest: LuBed,
}

/**
 * A campaign's GM screen (issue #764): the GM's own board of tools - the party
 * at a glance, Fear and countdowns, the turn order, pinned notes. Only the
 * campaign's GM reaches it; the players never see it.
 */
export default function GmScreenView() {
  const { t } = useTranslation()
  const { campaignId = '' } = useParams()
  const { user } = useAuth()!
  const [campaign, setCampaign] = useState<Schema<'CampaignOut'> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [status, setStatus] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const screen = useGmScreen(campaignId)
  const { panels, replace } = screen

  usePageTitle(campaign ? t('gmScreen.pageTitle', { name: campaign.name }) : null)

  useEffect(() => {
    campaigns
      .get(campaignId)
      .then(setCampaign)
      .catch((e: Error) => setLoadError(e.message))
  }, [campaignId])

  const context = useMemo(
    () => ({ campaignId, party: screen.party, setCharacterValue: screen.setCharacterValue }),
    [campaignId, screen.party, screen.setCharacterValue]
  )

  if (loadError) {
    return (
      <div role="alert" style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
        {loadError}
      </div>
    )
  }
  if (!campaign) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner size={28} />
      </div>
    )
  }
  if (campaign.owner_id !== user?.id) {
    return (
      <div role="alert" style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        {t('gmScreen.gmOnly')}
      </div>
    )
  }

  const kindTitle = (kind: PanelKind) => t(`gmScreen.kinds.${kind}`)
  const hasPanels = !!panels?.length

  const startBasic = async () => {
    try {
      replace(await gmScreen.importBoard(campaignId, STARTER_BOARD(kindTitle), true))
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  const exportBoard = async () => {
    const document = await gmScreen.exportBoard(campaignId)
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${campaign.name.replace(/[^\w.-]+/g, '-') || 'gm-screen'}.gm-screen.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importBoard = async (file: File) => {
    try {
      const document = JSON.parse(await file.text())
      const replaceBoard = !hasPanels || window.confirm(t('gmScreen.board.importReplace'))
      replace(await gmScreen.importBoard(campaignId, document, replaceBoard))
      setStatus(t('gmScreen.board.imported'))
    } catch (e) {
      setStatus(e instanceof SyntaxError ? t('gmScreen.board.notJson') : (e as Error).message)
    }
  }

  const reset = async (scope: Scope) => {
    await screen.reset(scope)
    setStatus(t(`gmScreen.resets.done.${scope}`))
  }

  const toolbarBtn = { ...ghostBtn, padding: '7px 12px' }

  return (
    <GmScreenContext.Provider value={context}>
      <div className="fade-in" style={{ padding: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <Link
            to={`/campaigns/${campaignId}/overview`}
            style={{ ...toolbarBtn, textDecoration: 'none' }}
          >
            <LuChevronLeft size={14} aria-hidden="true" /> {t('gmScreen.back')}
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            {t('gmScreen.heading')}
            <span
              style={{ fontSize: 15, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 10 }}
            >
              {campaign.name}
            </span>
          </h1>
        </div>

        {campaign.locked && (
          <p role="note" style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 0 }}>
            {t('gmScreen.locked')}
          </p>
        )}

        <div
          role="toolbar"
          aria-label={t('gmScreen.toolbar')}
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 16,
            alignItems: 'center',
          }}
        >
          <GmMenu
            label={
              <>
                <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.addTool')}
              </>
            }
            buttonStyle={{ ...goldBtn, padding: '7px 12px' }}
            items={PANEL_KINDS.map((kind) => ({
              key: kind,
              label: kindTitle(kind),
              onSelect: () => screen.addPanel(kind, kindTitle(kind)),
            }))}
          />
          {(['scene', 'session', 'rest'] as Scope[]).map((scope) => {
            const Icon = RESET_ICONS[scope]
            return (
              <button
                key={scope}
                type="button"
                onClick={() => reset(scope)}
                title={t(`gmScreen.resets.hint.${scope}`)}
                style={toolbarBtn}
              >
                <Icon size={14} aria-hidden="true" /> {t(`gmScreen.resets.action.${scope}`)}
              </button>
            )
          })}
          <GmMenu
            label={
              <>
                <LuLayoutGrid size={14} aria-hidden="true" /> {t('gmScreen.board.menu')}
              </>
            }
            buttonStyle={toolbarBtn}
            items={[
              {
                key: 'presets',
                label: t('gmScreen.board.presets'),
                icon: <LuPackage size={14} aria-hidden="true" />,
                onSelect: () => setDialog('presets'),
              },
              {
                key: 'copy',
                label: t('gmScreen.board.copy'),
                icon: <LuCopy size={14} aria-hidden="true" />,
                onSelect: () => setDialog('copy'),
              },
              {
                key: 'export',
                label: t('gmScreen.board.export'),
                icon: <LuDownload size={14} aria-hidden="true" />,
                onSelect: exportBoard,
                disabled: !hasPanels,
              },
              {
                key: 'import',
                label: t('gmScreen.board.import'),
                icon: <LuUpload size={14} aria-hidden="true" />,
                onSelect: () => importRef.current?.click(),
              },
            ]}
          />
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void importBoard(file)
            }}
          />
        </div>

        <div
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: 'var(--text-dim)', minHeight: 18 }}
        >
          {status}
        </div>
        {screen.error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
            {screen.error}{' '}
            <button
              type="button"
              onClick={screen.clearError}
              style={{ ...ghostBtn, padding: '2px 8px' }}
            >
              {t('gmScreen.dismiss')}
            </button>
          </p>
        )}

        {panels === null ? (
          <Spinner size={24} />
        ) : panels.length === 0 ? (
          <div style={{ ...emptyState, display: 'grid', gap: 12, justifyItems: 'center' }}>
            <p style={{ margin: 0 }}>{t('gmScreen.empty')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" onClick={startBasic} style={goldBtn}>
                {t('gmScreen.startBasic')}
              </button>
              <button type="button" onClick={() => setDialog('presets')} style={ghostBtn}>
                {t('gmScreen.board.presets')}
              </button>
              <button type="button" onClick={() => setDialog('copy')} style={ghostBtn}>
                {t('gmScreen.board.copy')}
              </button>
            </div>
          </div>
        ) : (
          <GmBoard
            panels={panels}
            onMove={screen.moveCells}
            renderPanel={(panel, handles) => (
              <GmPanel
                panel={panel}
                handles={handles}
                onSave={(patch) => screen.savePanel(panel.id, patch)}
                onRemove={() => screen.removePanel(panel.id)}
              />
            )}
          />
        )}

        {dialog === 'copy' && (
          <CopyBoardDialog
            campaignId={campaignId}
            hasPanels={hasPanels}
            onCopied={replace}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'presets' && (
          <PresetDialog
            campaignId={campaignId}
            hasPanels={hasPanels}
            onApplied={replace}
            onClose={() => setDialog(null)}
          />
        )}
      </div>
    </GmScreenContext.Provider>
  )
}
