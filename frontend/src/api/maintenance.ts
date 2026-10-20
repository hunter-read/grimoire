/**
 * Admin maintenance: backups, duplicate detection, metadata sidecars and the
 * add-on index check.
 */
import api, { client, getUrl, type Id, type BodyOf, type QueryOf, type Schema } from './client'

// Backups (issue #338). Admin-only. A backup is a timestamped .zip holding the
// database plus user-authored assets — never the library itself.
export const backups = {
  list: () => client.get('/backups'),
  create: () => client.post('/backups'),
  remove: (id: Id) => client.delete('/backups/{backup_id}', { path: { backup_id: id } }),
  getSettings: () => client.get('/backups/settings'),
  saveSettings: (data: BodyOf<'/backups/settings', 'put'>) =>
    client.put('/backups/settings', { body: data }),
  // Uses the shared download helper so the request carries the Authorization
  // header (and refreshes a stale token) rather than relying on a bare URL.
  download: (id: Id, filename: string) =>
    api.download(getUrl('/backups/{backup_id}/download', { path: { backup_id: id } }), filename),
}

type DuplicateGroupsQuery = QueryOf<'/duplicates/groups', 'get'>

/** The resource types duplicate detection covers. */
export type DuplicateType = NonNullable<Schema<'ScanRequest'>['resource_types']>[number]

// Duplicate detection and variant grouping (issues #304, #306). Every one of
// these is admin-only and, apart from the scan itself, acts on exactly the group
// the user is looking at - nothing here runs on its own.
export const duplicates = {
  scanStatus: () => client.get('/duplicates/scan-status'),
  startScan: (
    resourceTypes: DuplicateType[] = [],
    accuracy: NonNullable<Schema<'ScanRequest'>['accuracy']> = 'medium'
  ) => client.post('/duplicates/scan', { body: { resource_types: resourceTypes, accuracy } }),
  cancelScan: () => client.post('/duplicates/cancel-scan'),
  // Empty filters are dropped rather than sent as `key=`.
  groups: (params: { [K in keyof DuplicateGroupsQuery]?: DuplicateGroupsQuery[K] | '' } = {}) =>
    client.get('/duplicates/groups', {
      query: Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
      ) as DuplicateGroupsQuery,
    }),
  compare: (resourceType: DuplicateType, ids: string[]) =>
    client.get('/duplicates/compare', { query: { resource_type: resourceType, ids } }),
  // `parent` optionally names the main version as well (`{ kind, label }`);
  // left out, the parent keeps whatever description it already has.
  link: (
    resourceType: DuplicateType,
    parentId: string,
    children: BodyOf<'/duplicates/link', 'post'>['children'],
    parent: { kind?: string | null; label?: string | null } | null = null
  ) =>
    client.post('/duplicates/link', {
      body: {
        resource_type: resourceType,
        parent_id: parentId,
        children,
        ...(parent ? { parent_kind: parent.kind ?? '', parent_label: parent.label ?? '' } : {}),
      },
    }),
  // Set the kind and label one version shows in the picker, from either end of
  // the family. For a main version an empty kind and label mean "Main version".
  describe: (
    resourceType: DuplicateType,
    id: string,
    { kind = '', label = '' }: { kind?: string; label?: string } = {}
  ) =>
    client.post('/duplicates/describe', { body: { resource_type: resourceType, id, kind, label } }),
  // Hand an existing family a different main version. Distinct from `link`,
  // which refuses to put a parent under something else — see the promote
  // endpoint for why re-electing a parent needs its own call.
  promote: (
    resourceType: DuplicateType,
    {
      newParentId,
      oldParentId,
      kind = 'other',
      label = '',
    }: { newParentId: string; oldParentId: string; kind?: string; label?: string }
  ) =>
    client.post('/duplicates/promote', {
      body: {
        resource_type: resourceType,
        new_parent_id: newParentId,
        old_parent_id: oldParentId,
        kind,
        label,
      },
    }),
  unlink: (
    resourceType: DuplicateType,
    { ids = [], parentId = null }: { ids?: string[]; parentId?: string | null } = {}
  ) =>
    client.post('/duplicates/unlink', {
      body: { resource_type: resourceType, ids, parent_id: parentId },
    }),
  mergeMetadata: (payload: BodyOf<'/duplicates/merge-metadata', 'post'>) =>
    client.post('/duplicates/merge-metadata', { body: payload }),
  deleteItem: (
    resourceType: DuplicateType,
    itemId: string,
    options: { deleteFile?: boolean; reparentTo?: string | null } = {}
  ) =>
    client.delete('/duplicates/items/{resource_type}/{item_id}', {
      path: { resource_type: resourceType, item_id: itemId },
      body: {
        delete_file: options.deleteFile !== false,
        reparent_to: options.reparentTo ?? null,
      },
    }),
  dismiss: (resourceType: DuplicateType, memberIds: string[], note = '') =>
    client.post('/duplicates/dismiss', {
      body: { resource_type: resourceType, member_ids: memberIds, note },
    }),
  dismissals: (resourceType?: DuplicateType | null) =>
    client.get('/duplicates/dismissals', {
      query: { resource_type: resourceType || undefined },
    }),
  undismiss: (id: Id) =>
    client.delete('/duplicates/dismissals/{dismissal_id}', { path: { dismissal_id: id } }),
}

// Metadata sidecar export (issue #300). Admin-only; lives under /maintenance
// because it writes into the library rather than changing app behaviour.
export const sidecars = {
  get: () => client.get('/maintenance/sidecars/settings'),
  save: (data: BodyOf<'/maintenance/sidecars/settings', 'put'>) =>
    client.put('/maintenance/sidecars/settings', { body: data }),
  export: () => client.post('/maintenance/sidecars/export'),
}

export const addons = {
  verifyIndex: (url?: string | null) =>
    client.get('/addons/verify-index', { query: { url: url || '' } }),
  // A private source's access token (issue #642). The server never sends a
  // token back - only which header each source uses.
  setSourceCredential: (data: BodyOf<'/addons/sources/credential', 'put'>) =>
    client.put('/addons/sources/credential', { body: data }),
  clearSourceCredential: (url: string) =>
    client.delete('/addons/sources/credential', { query: { url } }),
}
