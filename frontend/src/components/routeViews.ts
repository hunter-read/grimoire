import lazyWithPreload from '../utils/lazyWithPreload'

// Each routed view is its own chunk (issue #708), fetched the first time its
// route renders, so a first load only downloads the shell and the page it opens.

export const BookReader = lazyWithPreload(() => import('./BookReader'))
export const LibraryView = lazyWithPreload(() => import('../views/LibraryView'))
export const SystemDetailView = lazyWithPreload(() => import('../views/SystemDetailView'))
export const MapsView = lazyWithPreload(() => import('../views/MapsView'))
export const MapDetailView = lazyWithPreload(() => import('./maps/MapDetailView'))
export const VttEditorView = lazyWithPreload(() => import('./maps/vtt/VttEditorView'))
export const TokensView = lazyWithPreload(() => import('../views/TokensView'))
export const TokenDetailView = lazyWithPreload(() => import('./tokens/TokenDetailView'))
export const TokenEditorView = lazyWithPreload(() => import('./tokens/editor/TokenEditorView'))
export const AudioView = lazyWithPreload(() => import('../views/AudioView'))
export const AudioDetailView = lazyWithPreload(() => import('./audio/AudioDetailView'))
export const ModelsView = lazyWithPreload(() => import('../views/ModelsView'))
export const ModelDetailView = lazyWithPreload(() => import('./models/ModelDetailView'))
export const SearchView = lazyWithPreload(() => import('../views/SearchView'))
export const SettingsView = lazyWithPreload(() => import('../views/SettingsView'))
export const FavoritesView = lazyWithPreload(() => import('../views/FavoritesView'))
export const TagsView = lazyWithPreload(() => import('../views/TagsView'))
export const FileManagerView = lazyWithPreload(() => import('../views/FileManagerView'))
export const DuplicatesView = lazyWithPreload(() => import('../views/DuplicatesView'))
export const DuplicateCompareView = lazyWithPreload(() => import('../views/DuplicateCompareView'))
export const CampaignsView = lazyWithPreload(() => import('../views/CampaignsView'))
export const CampaignDetailView = lazyWithPreload(() => import('../views/CampaignDetailView'))
export const CampaignNotesView = lazyWithPreload(() => import('../views/CampaignNotesView'))
export const CharactersView = lazyWithPreload(() => import('../views/CharactersView'))
export const CharacterDetailView = lazyWithPreload(() => import('../views/CharacterDetailView'))

// The view each sidebar destination opens, keyed by its first path segment.
const LANDING_VIEWS: Record<string, { preload: () => Promise<unknown> }> = {
  library: LibraryView,
  maps: MapsView,
  tokens: TokensView,
  audio: AudioView,
  models: ModelsView,
  search: SearchView,
  favorites: FavoritesView,
  tags: TagsView,
  campaigns: CampaignsView,
  characters: CharactersView,
  settings: SettingsView,
}

/**
 * Start fetching the view a link to `path` opens, so following it doesn't wait
 * on the network. A path with no known view is ignored, and a failed fetch is
 * left for the real navigation to retry and report.
 */
export function preloadRoute(path: string): void {
  const view = LANDING_VIEWS[path.split('/')[1] ?? '']
  view?.preload().catch(() => {})
}
