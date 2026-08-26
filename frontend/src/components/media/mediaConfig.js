import { LuMap, LuUser, LuMusic } from 'react-icons/lu'

/**
 * Per-entity configuration for the shared media gallery components (MediaCard,
 * MediaFolderGroup, GalleryToolbar) and the useMediaGallery hook.
 *
 * Maps and tokens share ~all of their gallery behaviour; the only differences are
 * captured here: the icon, grid sizing, REST endpoints, i18n key prefix, the
 * collection key in the API payload, and a small set of per-item badges.
 *
 * To add a new media type, add an entry here and render it through the shared
 * components — no new view/card/folder-group files needed.
 */
export const MEDIA_CONFIGS = {
  map: {
    // Singular type, used for favorites and resource_type payloads.
    type: 'map',
    // Key holding the array of items in the list/folder API responses.
    collection: 'maps',
    // i18n namespace prefix, e.g. t('maps.title').
    i18n: 'maps',
    // Pluralised folder-count key (maps.mapCount / tokens.tokenCount).
    countKey: 'mapCount',
    // Empty-state keys.
    emptyFilterKey: 'noMapsFilter',
    emptyKey: 'noMaps',
    icon: LuMap,
    // REST endpoints.
    listUrl: '/maps',
    foldersUrl: '/map-folders',
    itemUrl: (id) => `/maps/${id}`,
    thumbnailUrl: (id) => `/maps/${id}/thumbnail`,
    detailPath: (id) => `/maps/${id}`,
    downloadType: 'maps',
    archiveType: 'map_folder',
    sessionKey: 'grimoire:maps:collapsed',
    sortOptions: ['name', 'size'],
    // Grid cell min width per card size.
    gridMin: { comfortable: '200px', compact: '140px' },
    gridGap: 16,
    // Card thumbnail layout in grid mode.
    thumb: { kind: 'fixedHeight', height: 140 },
    // Badges shown on a card, keyed by item flag. `corner` badges sit on the
    // thumbnail; `inline` badges render in the list-mode metadata row.
    badges: [
      {
        // variant_count is a number, and the badge system treats any truthy
        // value as "show it" - so 0 hides this without a special case.
        flag: 'variant_count',
        labelKey: 'common.versions',
        label: 'versions',
        color: 'rgba(79,209,197,0.9)',
        corner: 'top-right',
        inlineColor: 'var(--variant)',
      },
      {
        flag: 'is_archive',
        // Absolute i18n key — the archive label is shared, not per-collection.
        labelKey: 'common.archive',
        label: 'archive',
        color: 'rgba(90,110,160,0.9)',
        corner: 'top-left',
        inlineColor: '#8fa3cc',
      },
      {
        flag: 'is_missing',
        label: 'missing',
        color: 'rgba(200,134,10,0.9)',
        corner: 'bottom-left',
        inlineColor: 'var(--warning)',
      },
    ],
    titleFontSize: 15,
    listIcon: { width: 56, height: 36 },
  },
  token: {
    type: 'token',
    collection: 'tokens',
    i18n: 'tokens',
    countKey: 'tokenCount',
    emptyFilterKey: 'noTokensFilter',
    emptyKey: 'noTokens',
    icon: LuUser,
    listUrl: '/tokens',
    foldersUrl: '/token-folders',
    itemUrl: (id) => `/tokens/${id}`,
    thumbnailUrl: (id) => `/tokens/${id}/thumbnail`,
    detailPath: (id) => `/tokens/${id}`,
    downloadType: 'tokens',
    archiveType: 'token_folder',
    sessionKey: 'grimoire:tokens:collapsed',
    sortOptions: ['name', 'size'],
    gridMin: { comfortable: '130px', compact: '90px' },
    gridGap: 12,
    thumb: { kind: 'square' },
    badges: [
      {
        // variant_count is a number, and the badge system treats any truthy
        // value as "show it" - so 0 hides this without a special case.
        flag: 'variant_count',
        labelKey: 'common.versions',
        label: 'versions',
        color: 'rgba(79,209,197,0.9)',
        corner: 'top-right',
        inlineColor: 'var(--variant)',
      },
      {
        flag: 'is_archive',
        // Absolute i18n key — the archive label is shared, not per-collection.
        labelKey: 'common.archive',
        label: 'archive',
        color: 'rgba(90,110,160,0.9)',
        corner: 'top-left',
        inlineColor: '#8fa3cc',
      },
      {
        flag: 'is_explicit',
        label: 'explicit',
        color: 'rgba(180,60,60,0.85)',
        corner: 'bottom-right',
        inlineColor: 'var(--danger)',
      },
      {
        flag: 'is_missing',
        label: 'missing',
        color: 'rgba(200,134,10,0.9)',
        corner: 'bottom-left',
        inlineColor: 'var(--warning)',
      },
    ],
    titleFontSize: 13,
    listIcon: { width: 40, height: 40 },
  },
  audio: {
    type: 'audio',
    collection: 'audio',
    i18n: 'audio',
    countKey: 'audioCount',
    emptyFilterKey: 'noAudioFilter',
    emptyKey: 'noAudio',
    icon: LuMusic,
    listUrl: '/audio',
    foldersUrl: '/audio-folders',
    itemUrl: (id) => `/audio/${id}`,
    // Audio uses folder/embedded artwork in place of a generated thumbnail.
    thumbnailUrl: (id) => `/audio/${id}/artwork`,
    thumbnailFlag: 'has_artwork',
    detailPath: (id) => `/audio/${id}`,
    downloadType: 'audio',
    archiveType: 'audio_folder',
    sessionKey: 'grimoire:audio:collapsed',
    sortOptions: ['title', 'name', 'duration', 'size'],
    gridMin: { comfortable: '200px', compact: '140px' },
    gridGap: 16,
    thumb: { kind: 'square' },
    // Inline play/pause button overlaid on the card artwork.
    audioFileUrl: (id) => `/audio/${id}/file`,
    badges: [
      {
        // variant_count is a number, and the badge system treats any truthy
        // value as "show it" - so 0 hides this without a special case.
        flag: 'variant_count',
        labelKey: 'common.versions',
        label: 'versions',
        color: 'rgba(79,209,197,0.9)',
        corner: 'top-right',
        inlineColor: 'var(--variant)',
      },
      {
        flag: 'is_archive',
        // Absolute i18n key — the archive label is shared, not per-collection.
        labelKey: 'common.archive',
        label: 'archive',
        color: 'rgba(90,110,160,0.9)',
        corner: 'top-left',
        inlineColor: '#8fa3cc',
      },
      {
        flag: 'is_missing',
        label: 'missing',
        color: 'rgba(200,134,10,0.9)',
        corner: 'bottom-left',
        inlineColor: 'var(--warning)',
      },
    ],
    titleFontSize: 14,
    listIcon: { width: 40, height: 40 },
  },
}

/** Folder path helpers — interpret `relative_path` as `<collection>/<top>/<sub>/<file>`. */
export const getFolderPath = (item) => {
  const parts = (item.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(1, -1).join('/')
}

export const getTopFolder = (item) => {
  const parts = (item.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > 2 ? parts[1] : '(Root)'
}

export const getSubPath = (item) => {
  const parts = (item.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(2, -1).join('/')
}

/**
 * Every folder path that owns an item, from its own folder up to the top-level
 * one. `Fall Of Blackbottom/Alleyways` yields ['Fall Of Blackbottom/Alleyways',
 * 'Fall Of Blackbottom'], so a tag set on an ancestor folder reaches the items
 * nested below it.
 */
export const getFolderAncestors = (item) => {
  const parts = (item.relative_path || '').replace(/\\/g, '/').split('/').slice(1, -1)
  const out = []
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * An item's effective tags: its own plus the tags of every folder above it.
 * Folder tags are inherited down the tree (issue: a tag on a parent folder must
 * apply to maps in its subfolders), and the backend's tag counting already
 * resolves folder tags through ancestor paths — this matches that behaviour in
 * the gallery. Returned de-duplicated case-insensitively, own tags first.
 */
export const getEffectiveTags = (item, folderTags = {}) => {
  const out = []
  const seen = new Set()
  const push = (tag) => {
    const lower = String(tag).toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      out.push(tag)
    }
  }
  ;(item.tags || []).forEach(push)
  for (const path of getFolderAncestors(item)) (folderTags[path] || []).forEach(push)
  return out
}
