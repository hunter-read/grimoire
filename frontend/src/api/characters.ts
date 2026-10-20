/**
 * Characters: sheets and their schemas, the content catalogue, and rulesets.
 */
import api, {
  client,
  getUrl,
  postUrl,
  mediaUrl,
  cacheBust,
  withQuery,
  presentParams,
  type Id,
  type BodyOf,
  type QueryOf,
  type ResponseOf,
} from './client'

type CharacterQuery = QueryOf<'/characters', 'get'>

/**
 * Character sheets (issue #129).
 *
 * Schemas and characters are both per-user, like themes: installing a sheet
 * cannot affect anyone else, so there is no admin step. Computed values come
 * back from the server on every read rather than being stored, so a corrected
 * formula fixes every character built on it.
 */
export const characters = {
  listSchemas: () => client.get('/characters/schemas'),
  getSchema: (schemaId: string) =>
    client.get('/characters/schemas/{schema_id}', { path: { schema_id: schemaId } }),
  importSchema: (body: BodyOf<'/characters/schemas', 'post'>) =>
    client.post('/characters/schemas', { body }),
  browseSheets: () => client.get('/characters/schemas/browse'),
  installSheet: (sheetId: string) =>
    client.post('/characters/schemas/install/{sheet_id}', { path: { sheet_id: sheetId } }),
  deleteSchema: (schemaId: string) =>
    client.delete('/characters/schemas/{schema_id}', { path: { schema_id: schemaId } }),
  // A string is read as a schema filter, which is what Phase 1 callers pass.
  list: (params: CharacterQuery | string | null = {}) =>
    client.get('/characters', {
      query: presentParams(typeof params === 'string' ? { schema_ref: params } : params || {}),
    }),
  get: (id: Id) => client.get('/characters/{character_id}', { path: { character_id: id } }),
  create: (body: BodyOf<'/characters', 'post'>) => client.post('/characters', { body }),
  update: (id: Id, body: BodyOf<'/characters/{character_id}', 'put'>) =>
    client.put('/characters/{character_id}', { path: { character_id: id }, body }),
  remove: (id: Id) => client.delete('/characters/{character_id}', { path: { character_id: id } }),
  export: (id: Id) =>
    client.get('/characters/{character_id}/export', { path: { character_id: id } }),
  import: (payload: BodyOf<'/characters/import', 'post'>['payload'], importEntries = true) =>
    client.post('/characters/import', { body: { payload, import_entries: importEntries } }),
  // Other tools' characters, through the character-importer add-ons an admin
  // has installed. `body` is `{text, filename}` for a file or `{url}` for a
  // link, plus an optional `importer_id` to settle which importer reads it.
  listImporters: () => client.get('/characters/importers'),
  importExternal: (body: BodyOf<'/characters/import/external', 'post'>) =>
    client.post('/characters/import/external', { body }),
  // A file-only YAML importer into your own account, or removing it again.
  installImporter: (id: string) =>
    client.post('/characters/importers/{importer_id}/install', { path: { importer_id: id } }),
  removeImporter: (id: string) =>
    client.delete('/characters/importers/{importer_id}', { path: { importer_id: id } }),
  // An admin installing an importer for everyone: the ordinary add-on install.
  installImporterForEveryone: (id: string, indexUrl?: string | null) =>
    client.post('/addons/{addon_id}/install', {
      path: { addon_id: id },
      body: { approve_script: false, ...(indexUrl ? { index_url: indexUrl } : {}) },
    }),
  // `v` is the character's `portrait_version`, which changes with the image:
  // portraits are cached for minutes, so the same URL would keep showing the
  // old art after a replacement.
  portraitUrl: (id: Id, v?: Id | null) =>
    mediaUrl(
      getUrl('/characters/{character_id}/portrait', { path: { character_id: id } }),
      cacheBust(v)
    ),
  uploadPortrait: (id: Id, file: Blob) =>
    api.upload(
      postUrl('/characters/{character_id}/portrait', { path: { character_id: id } }),
      file
    ),
  deletePortrait: (id: Id) =>
    client.delete('/characters/{character_id}/portrait', { path: { character_id: id } }),
  // A sheet's `image` fields. The stored value is the file's name, which
  // changes with every upload, so it is also the URL's cache-buster.
  imageUrl: (id: Id, field: string, value?: string | null) =>
    mediaUrl(
      getUrl('/characters/{character_id}/images/{field}', {
        path: { character_id: id, field },
      }),
      cacheBust(value)
    ),
  uploadImage: (id: Id, field: string, file: Blob) =>
    api.upload(
      postUrl('/characters/{character_id}/images/{field}', {
        path: { character_id: id, field },
      }),
      file
    ) as Promise<ResponseOf<'/characters/{character_id}/images/{field}', 'post'>>,
  deleteImage: (id: Id, field: string) =>
    client.delete('/characters/{character_id}/images/{field}', {
      path: { character_id: id, field },
    }),
}

/**
 * Character content catalog (issue #131).
 *
 * Packs are server-wide and installed by an admin, but the catalog is described
 * by the calling user's own copy of the schema — two people may have different
 * versions installed, and each browses what their copy declares.
 */
export const contentAdmin = {
  reloadPacks: () => client.post('/content/packs/reload'),
}

type ContentBrowseQuery = QueryOf<'/content/{schema_id}/{content_type}', 'get'>

export const content = {
  packs: (schemaId?: string | null) =>
    client.get('/content/packs', { query: { schema_id: schemaId || undefined } }),
  types: (schemaId: string) =>
    client.get('/content/{schema_id}/types', { path: { schema_id: schemaId } }),
  // Filters travel as filter[field]=value, which is the shape the catalog
  // endpoint reads them back out of; the schema cannot declare those keys, so
  // they are appended after the declared parameters.
  browse: (
    schemaId: string,
    contentType: string,
    { filters = {}, ...params }: ContentBrowseQuery & { filters?: Record<string, unknown> } = {}
  ) =>
    api.get(
      withQuery(
        getUrl('/content/{schema_id}/{content_type}', {
          path: { schema_id: schemaId, content_type: contentType },
          query: presentParams(params),
        }),
        Object.entries(filters)
          .filter(([, wanted]) => wanted !== '' && wanted !== undefined)
          .map(([field, wanted]): [string, string] => [`filter[${field}]`, String(wanted)])
      )
    ) as Promise<ResponseOf<'/content/{schema_id}/{content_type}', 'get'>>,
  entry: (schemaId: string, contentType: string, entryId: string) =>
    client.get('/content/{schema_id}/{content_type}/{entry_id}', {
      path: { schema_id: schemaId, content_type: contentType, entry_id: entryId },
    }),
  resolve: (schemaId: string, ids: string[]) =>
    client.get('/content/{schema_id}/resolve', {
      path: { schema_id: schemaId },
      query: { ids: ids.join(',') },
    }),
}

/**
 * Rulesets (issue #132).
 *
 * A named set of catalogue content that belongs either to a campaign —
 * everyone at that table reads it, the GM edits it — or to the server, which
 * every game can use. That is what lets two games in the same system allow
 * different content.
 */
export const rulesets = {
  list: (params: QueryOf<'/rulesets', 'get'> = {}) =>
    client.get('/rulesets', { query: presentParams(params) }),
  get: (id: Id) => client.get('/rulesets/{ruleset_id}', { path: { ruleset_id: id } }),
  create: (body: BodyOf<'/rulesets', 'post'>) => client.post('/rulesets', { body }),
  update: (id: Id, body: BodyOf<'/rulesets/{ruleset_id}', 'put'>) =>
    client.put('/rulesets/{ruleset_id}', { path: { ruleset_id: id }, body }),
  remove: (id: Id) => client.delete('/rulesets/{ruleset_id}', { path: { ruleset_id: id } }),
  browsePacks: () => client.get('/rulesets/packs/browse'),
  installPack: (packId: string) =>
    client.post('/rulesets/packs/install/{pack_id}', { path: { pack_id: packId } }),
  uninstallPack: (packId: string) =>
    client.delete('/rulesets/packs/{pack_id}', { path: { pack_id: packId } }),
  installable: (schemaId?: string | null) =>
    client.get('/rulesets/installable', { query: { schema_id: schemaId || undefined } }),
  import: (id: Id, body: BodyOf<'/rulesets/{ruleset_id}/import', 'post'>) =>
    client.post('/rulesets/{ruleset_id}/import', { path: { ruleset_id: id }, body }),
  export: (id: Id) => client.get('/rulesets/{ruleset_id}/export', { path: { ruleset_id: id } }),
  entries: (id: Id, contentType?: string | null) =>
    client.get('/rulesets/{ruleset_id}/entries', {
      path: { ruleset_id: id },
      query: { content_type: contentType || undefined },
    }),
  createEntry: (id: Id, body: BodyOf<'/rulesets/{ruleset_id}/entries', 'post'>) =>
    client.post('/rulesets/{ruleset_id}/entries', { path: { ruleset_id: id }, body }),
  getEntry: (id: Id, entryId: Id) =>
    client.get('/rulesets/{ruleset_id}/entries/{entry_row_id}', {
      path: { ruleset_id: id, entry_row_id: entryId },
    }),
  updateEntry: (
    id: Id,
    entryId: Id,
    body: BodyOf<'/rulesets/{ruleset_id}/entries/{entry_row_id}', 'put'>
  ) =>
    client.put('/rulesets/{ruleset_id}/entries/{entry_row_id}', {
      path: { ruleset_id: id, entry_row_id: entryId },
      body,
    }),
  removeEntry: (id: Id, entryId: Id) =>
    client.delete('/rulesets/{ruleset_id}/entries/{entry_row_id}', {
      path: { ruleset_id: id, entry_row_id: entryId },
    }),
  fork: (id: Id, body: BodyOf<'/rulesets/{ruleset_id}/fork', 'post'>) =>
    client.post('/rulesets/{ruleset_id}/fork', { path: { ruleset_id: id }, body }),
}
