/**
 * A library system's compendium (issue #835): the rules content linked to it.
 *
 * A system links the content packs that fill it and the character sheets its
 * players use; GMs and admins set the links, everyone who can see the system
 * reads the compendium.
 */
import api, {
  client,
  getUrl,
  presentParams,
  withQuery,
  type QueryOf,
  type ResponseOf,
} from './client'

type BrowseQuery = QueryOf<'/systems/{system_id}/compendium/{content_type}', 'get'>

export const compendium = {
  get: (systemId: string) =>
    client.get('/systems/{system_id}/compendium', { path: { system_id: systemId } }),
  // A list left out is left as it is.
  setLinks: (systemId: string, body: { pack_ids?: string[]; sheet_ids?: string[] }) =>
    client.put('/systems/{system_id}/compendium/links', { path: { system_id: systemId }, body }),
  // Filters travel as filter[field]=value, the shape the sheet's content
  // browser uses; the schema cannot declare those keys.
  browse: (
    systemId: string,
    contentType: string,
    { filters = {}, ...params }: BrowseQuery & { filters?: Record<string, string> } = {}
  ) =>
    api.get(
      withQuery(
        getUrl('/systems/{system_id}/compendium/{content_type}', {
          path: { system_id: systemId, content_type: contentType },
          query: presentParams(params),
        }),
        Object.entries(filters)
          .filter(([, wanted]) => wanted !== '')
          .map(([field, wanted]): [string, string] => [`filter[${field}]`, wanted])
      )
    ) as Promise<ResponseOf<'/systems/{system_id}/compendium/{content_type}', 'get'>>,
  entry: (systemId: string, contentType: string, entryId: string, origin?: string | null) =>
    client.get('/systems/{system_id}/compendium/{content_type}/{entry_id}', {
      path: { system_id: systemId, content_type: contentType, entry_id: entryId },
      query: { origin: origin || undefined },
    }),
  searchSystem: (systemId: string, q: string) =>
    client.get('/systems/{system_id}/compendium/search', {
      path: { system_id: systemId },
      query: { q },
    }),
  // Every system the caller can see, for global search.
  search: (q: string, systemId?: string | null) =>
    client.get('/compendium/search', { query: { q, system_id: systemId || undefined } }),
}
