/**
 * The library itself: tags, file management, bulk edits, image sources and
 * token frames.
 */
import api, {
  client,
  getUrl,
  postUrl,
  mediaUrl,
  type Id,
  type BodyOf,
  type ResponseOf,
  type RequestOptions,
} from './client'
import type { Operation, PathsFor } from './types'
import { campaigns } from './campaigns'

type TagItemsPage = ResponseOf<'/tags/{internal}/items', 'get'>

export const tags = {
  // in_use_by scopes the list to tags used on a resource type (with counts).
  list: (inUseBy?: string | null) =>
    client.get('/tags', { query: { in_use_by: inUseBy || undefined } }),
  // A tag's per-type counts and folders, plus a page of the items carrying it
  // directly (issue #221). `limit: 0` is the summary alone.
  items: (
    internal: string,
    resourceType?: string | null,
    { limit, offset }: { limit?: number; offset?: number } = {}
  ) =>
    client.get('/tags/{internal}/items', {
      path: { internal },
      query: {
        resource_type: resourceType || undefined,
        limit,
        offset: offset || undefined,
      },
    }),
  // A page of everything inside one tagged folder (`folder` is the group's `key`).
  folderItems: (
    internal: string,
    resourceType: string,
    folder: string,
    { limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}
  ) =>
    client.get('/tags/{internal}/folder-items', {
      path: { internal },
      query: { resource_type: resourceType, folder, limit, offset },
    }),
  // Every item carrying the tag directly, across all pages.
  allItems: async (internal: string): Promise<TagItemsPage['items']> => {
    const out: TagItemsPage['items'] = []
    for (let offset = 0; ; offset += 500) {
      const page = await tags.items(internal, undefined, { limit: 500, offset })
      out.push(...(page.items || []))
      if (!page.items?.length || out.length >= page.total) return out
    }
  },
  create: (value: string, display?: string | null) =>
    client.post('/tags', { body: { value, display } }),
  rename: (internal: string, display: string) =>
    client.patch('/tags/{internal}', { path: { internal }, body: { display } }),
  merge: (internal: string, into: string) =>
    client.post('/tags/{internal}/merge', { path: { internal }, body: { into } }),
  remove: (internal: string) => client.delete('/tags/{internal}', { path: { internal } }),
}

/** The resource types the bulk editor and file manager act on. */
export type BulkType = 'book' | 'system' | 'map' | 'token' | 'audio' | 'model'

/** The media types whose folders carry tags. */
export type FolderTagType = 'map' | 'token' | 'audio' | 'model'

// Setting an image from one Grimoire already holds (issue #286). Banner, system
// cover, and audio cover all copy the chosen bytes server-side, so each target
// keeps its own storage and its GET route is unchanged — only the source of the
// bytes differs from a device upload.
export const imageSources = {
  // Library assets the picker can browse, reusing the campaign resource search
  // (books/maps/tokens/audio) that already searches the whole library.
  search: (q = '', resourceType = '', limit = 2000) =>
    campaigns.searchResources(q, resourceType, '', limit),
  setSystemCover: (systemId: Id, sourceType: string, sourceId: string) =>
    client.post('/systems/{system_id}/cover/from-source', {
      path: { system_id: systemId },
      body: { source_type: sourceType, source_id: sourceId },
    }),
  // A book's custom cover, replacing its generated thumbnail everywhere.
  setBookCover: (bookId: Id, sourceType: string, sourceId: string) =>
    client.post('/books/{book_id}/cover/from-source', {
      path: { book_id: bookId },
      body: { source_type: sourceType, source_id: sourceId },
    }),
  uploadBookCover: (bookId: Id, file: Blob) =>
    api.upload(postUrl('/books/{book_id}/cover', { path: { book_id: bookId } }), file) as Promise<
      ResponseOf<'/books/{book_id}/cover', 'post'>
    >,
  deleteBookCover: (bookId: Id) =>
    client.delete('/books/{book_id}/cover', { path: { book_id: bookId } }),
  setAudioCover: (audioId: Id, sourceType: string, sourceId: string) =>
    client.post('/audio/{audio_id}/cover/from-source', {
      path: { audio_id: audioId },
      body: { source_type: sourceType, source_id: sourceId },
    }),
  uploadAudioCover: (audioId: Id, file: Blob) =>
    api.upload(postUrl('/audio/{audio_id}/cover', { path: { audio_id: audioId } }), file),
  deleteAudioCover: (audioId: Id) =>
    client.delete('/audio/{audio_id}/cover', { path: { audio_id: audioId } }),
  // Thumbnail for a picker row. Books/maps/tokens each have their own endpoint;
  // audio shows its artwork.
  thumbUrl: (resourceType: string, id: Id): string | null => {
    const paths: Record<string, () => string> = {
      book: () => getUrl('/books/{book_id}/thumbnail', { path: { book_id: id } }),
      map: () => getUrl('/maps/{map_id}/thumbnail', { path: { map_id: id } }),
      token: () => getUrl('/tokens/{token_id}/thumbnail', { path: { token_id: id } }),
      audio: () => getUrl('/audio/{audio_id}/artwork', { path: { audio_id: id } }),
      model: () => getUrl('/models/{model_id}/thumbnail', { path: { model_id: id } }),
    }
    return Object.hasOwn(paths, resourceType) ? mediaUrl(paths[resourceType]()) : null
  },
}

/**
 * Token frames — overlay art for the in-app token editor.
 *
 * Only *user* frames come from the API. The built-in three are bundled with the
 * frontend and resolved client-side (see components/tokens/editor/frames.ts), so
 * the editor still has frames when the library is empty or unreadable.
 */
export const tokenFrames = {
  list: () => client.get('/token-frames'),
  fileUrl: (frameId: string) =>
    mediaUrl(getUrl('/token-frames/{frame_id}/file', { path: { frame_id: frameId } })),
}

// The full record behind a file-manager row, by collection.
const RECORDS = {
  book: (id: Id) => client.get('/books/{book_id}', { path: { book_id: id } }),
  system: (id: Id) => client.get('/systems/{system_id}', { path: { system_id: id } }),
  map: (id: Id) => client.get('/maps/{map_id}', { path: { map_id: id } }),
  token: (id: Id) => client.get('/tokens/{token_id}', { path: { token_id: id } }),
  audio: (id: Id) => client.get('/audio/{audio_id}', { path: { audio_id: id } }),
  model: (id: Id) => client.get('/models/{model_id}', { path: { model_id: id } }),
} satisfies Record<BulkType, (id: Id) => Promise<unknown>>

/**
 * Library file management (issue #302) — admin only.
 *
 * Every `path` here is relative to the library root and forward-slashed; the
 * backend rejects anything that escapes it. Paths are sent in the JSON body
 * rather than the URL so that names containing `#`, `?`, or `%` survive the
 * round trip intact.
 */
/**
 * Filename rules (issues #521, #522, #569): a books folder's naming pattern,
 * which reads titles out of filenames and can rename files onto itself, and the
 * library's own variant markers for duplicate review.
 */
export const naming = {
  folders: () => client.get('/naming/folders'),
  saveFolder: (path: string, pattern: string) =>
    client.put('/naming/folders', { body: { path, pattern } }),
  deleteFolder: (path: string) => client.delete('/naming/folders', { query: { path } }),
  // `pattern` previews an unsaved pattern; omit it for the folder's saved one.
  preview: (path: string, pattern?: string) =>
    client.post('/naming/preview', { body: { path, pattern: pattern ?? null } }),
  applyTitles: (path: string, ids: string[]) =>
    client.post('/naming/apply-titles', { body: { path, ids } }),
  rename: (path: string, ids: string[]) => client.post('/naming/rename', { body: { path, ids } }),
  variantRules: () => client.get('/naming/variant-rules'),
  saveVariantRules: (rules: BodyOf<'/naming/variant-rules', 'put'>['rules']) =>
    client.put('/naming/variant-rules', { body: { rules } }),
}

export const files = {
  browse: (path = '') => client.get('/files/browse', { query: { path: path || undefined } }),
  // `onConflict` is 'skip' (report the collision, leave the file) or 'rename'
  // (land it under a suffixed name). Neither ever overwrites.
  move: (
    sources: string[],
    destination: string,
    onConflict: BodyOf<'/files/move', 'post'>['on_conflict'] = 'skip'
  ) => client.post('/files/move', { body: { sources, destination, on_conflict: onConflict } }),
  rename: (path: string, newName: string) =>
    client.post('/files/rename', { body: { path, new_name: newName } }),
  createFolder: (
    parent: string,
    name: string,
    {
      containerKind = '',
      nsfw = false,
      framesContainer = false,
    }: { containerKind?: string; nsfw?: boolean; framesContainer?: boolean } = {}
  ) =>
    client.post('/files/folder', {
      body: {
        parent,
        name,
        container_kind: containerKind,
        nsfw,
        frames_container: framesContainer,
      },
    }),
  // Each marker is tri-state: omitted leaves it untouched, so toggling one
  // never clears another. `framesContainer` is its own axis rather than a
  // container kind — it marks a tokens/ folder's images as token-editor frames.
  setMarkers: (
    path: string,
    {
      containerKind,
      nsfw,
      framesContainer,
    }: { containerKind?: string; nsfw?: boolean; framesContainer?: boolean } = {}
  ) =>
    client.put('/files/folder/markers', {
      body: {
        path,
        ...(containerKind !== undefined ? { container_kind: containerKind } : {}),
        ...(nsfw !== undefined ? { nsfw } : {}),
        ...(framesContainer !== undefined ? { frames_container: framesContainer } : {}),
      },
    }),
  // A folder holding nothing but markers and empty descendants deletes on
  // request; one still holding content needs `confirmName` to match its own
  // name, or the API answers 428.
  deleteFolder: (path: string, confirmName?: string | null) =>
    client.delete('/files/folder', { body: { path, confirm_name: confirmName ?? null } }),
  // Two deletes behind one call. Soft by default (`deleteFiles` false): the
  // record goes, the file stays, and a rescan re-adds it. For clearing an entry
  // after a .grimoireignore, or one whose file vanished outside Grimoire.
  // `deleteFiles` true is irreversible: the file goes too, with every tag,
  // favorite, bookmark, and campaign link the record carried.
  deleteEntry: (path: string, confirmName?: string | null, deleteFiles = false) =>
    client.post('/files/delete', {
      body: { path, confirm_name: confirmName ?? null, delete_files: deleteFiles },
    }),
  // Whether a folder holds content, so the UI knows to demand the typed name.
  // Asked of the server rather than counted from a listing: the listing hides
  // sidecars and markers, so the two definitions of "empty" would disagree.
  folderContents: (path: string) => client.get('/files/folder/contents', { query: { path } }),
  // Create the standard category folders inside a system folder.
  scaffold: (path: string) => client.post('/files/folder/scaffold', { body: { path } }),
  // Fetch the full record behind a listing row, so the shared metadata editor
  // has the same object the item pages give it. The listing itself carries only
  // what a row needs to render.
  // An unknown collection rejects like a failed request, rather than throwing.
  record: (collection: BulkType, id: Id) =>
    Object.hasOwn(RECORDS, collection)
      ? RECORDS[collection](id)
      : Promise.reject(new Error(`Unknown collection: ${collection}`)),
}

// The collection paths each bulk-editable resource type lives under. Keyed by
// the `type` the bulk UI already uses, so callers pass the same string throughout.
const BULK_TAG_PATHS = {
  book: '/books/bulk/tags',
  system: '/systems/bulk/tags',
  map: '/maps/bulk/tags',
  token: '/tokens/bulk/tags',
  audio: '/audio/bulk/tags',
  model: '/models/bulk/tags',
} as const satisfies Record<BulkType, PathsFor<'post'>>

const BULK_UPDATE_PATHS = {
  book: '/books/bulk',
  system: '/systems/bulk',
  map: '/maps/bulk',
  token: '/tokens/bulk',
  audio: '/audio/bulk',
  model: '/models/bulk',
} as const satisfies Record<BulkType, PathsFor<'post'>>

// Folder-tag collections that support batched writes (media folder tagging).
const BULK_FOLDER_PATHS = {
  map: '/map-folders/bulk',
  token: '/token-folders/bulk',
  audio: '/audio-folders/bulk',
  model: '/model-folders/bulk',
} as const satisfies Record<FolderTagType, PathsFor<'post'>>

/**
 * Bulk operations (issue #270).
 *
 * These replace the old one-request-per-item fan-out, which raced on tag
 * creation server-side and returned intermittent 500s. Each call sends the whole
 * selection in a single request that the backend applies in one transaction.
 *
 * Every response is `{updated: [id], errors: [{id, detail}]}`; `addTags` also
 * returns `tags` keyed by id so callers can patch local state without refetching.
 */
export const bulk = {
  // Additively apply `tags` to every id — never removes existing tags.
  addTags: (type: BulkType, ids: string[], tags: string[]) =>
    client.post(BULK_TAG_PATHS[type], { body: { ids, tags } }),
  // Apply per-item field edits. `items` is [{id, ...fields}]; a per-item `tags`
  // list replaces that item's tags outright.
  update: (type: BulkType, items: BodyOf<(typeof BULK_UPDATE_PATHS)[BulkType], 'post'>['items']) =>
    client.post(BULK_UPDATE_PATHS[type], { body: { items } } as RequestOptions<
      Operation<(typeof BULK_UPDATE_PATHS)[BulkType], 'post'>
    >),
  // Set tags on many folders at once. `folders` is [{path, tags}].
  setFolderTags: (type: FolderTagType, folders: { path: string; tags: string[] }[]) =>
    client.post(BULK_FOLDER_PATHS[type], { body: { folders } }),
}
