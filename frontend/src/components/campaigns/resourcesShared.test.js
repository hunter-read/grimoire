import { describe, it, expect } from 'vitest'
import {
  TYPE_ICONS,
  RESOURCE_NAV,
  VISIBILITY_OPTIONS,
  selectStyle,
  buildFolderTree,
  nodeResources,
  resourceKey,
  PICKER_TYPES,
} from './resourcesShared'

const R = (id, subtitle) => ({ resource_type: 'book', resource_id: id, name: id, subtitle })

describe('resourcesShared', () => {
  it('has icons for every resource type including audio', () => {
    for (const type of ['book', 'map', 'token', 'audio', 'file']) {
      expect(TYPE_ICONS[type]).toBeTruthy()
      expect(TYPE_ICONS[type].Icon).toBeTruthy()
    }
  })

  it('builds navigation paths for library resource types', () => {
    expect(RESOURCE_NAV.book('b1')).toBe('/library/book/b1')
    expect(RESOURCE_NAV.map('m1')).toBe('/maps/m1')
    expect(RESOURCE_NAV.token('t1')).toBe('/tokens/t1')
    expect(RESOURCE_NAV.audio('a1')).toBe('/audio/a1')
  })

  it('exposes visibility options in priority order', () => {
    expect(VISIBILITY_OPTIONS).toEqual(['public', 'private', 'gm'])
  })

  it('exposes a select style object', () => {
    expect(selectStyle).toHaveProperty('cursor', 'pointer')
  })
})

describe('resourceKey', () => {
  it('joins type and id', () => {
    expect(resourceKey({ resource_type: 'map', resource_id: 'm1' })).toBe('map:m1')
  })
})

describe('PICKER_TYPES', () => {
  it('is book/map/token/audio with no "all"', () => {
    expect(PICKER_TYPES).toEqual(['book', 'map', 'token', 'audio'])
  })
})

describe('buildFolderTree', () => {
  it('nests arbitrarily deep folder paths', () => {
    const tree = buildFolderTree([R('b1', 'adventures/ravenloft/act1')], 'Other')
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('adventures')
    expect(tree[0].folders[0].name).toBe('ravenloft')
    expect(tree[0].folders[0].folders[0].name).toBe('act1')
    expect(tree[0].folders[0].folders[0].items.map((r) => r.resource_id)).toEqual(['b1'])
  })

  it('buckets items with no subtitle under the ungrouped label', () => {
    const tree = buildFolderTree([R('b1', '')], 'Other')
    expect(tree[0].name).toBe('Other')
    expect(tree[0].items.map((r) => r.resource_id)).toEqual(['b1'])
  })

  it('merges siblings sharing a parent folder', () => {
    const tree = buildFolderTree([R('b1', 'core'), R('b2', 'core')], 'Other')
    expect(tree).toHaveLength(1)
    expect(tree[0].items.map((r) => r.resource_id).sort()).toEqual(['b1', 'b2'])
  })

  it('sorts folders alphabetically', () => {
    const tree = buildFolderTree([R('zeta', 'z'), R('alpha', 'a')], 'Other')
    expect(tree.map((n) => n.name)).toEqual(['a', 'z'])
  })

  it('pins a matching top-level folder to the front, rest alphabetical', () => {
    const tree = buildFolderTree(
      [R('b1', 'Beta'), R('b2', 'Alpha'), R('b3', 'Chosen'), R('b4', 'Delta')],
      'Other',
      'Chosen'
    )
    expect(tree.map((n) => n.name)).toEqual(['Chosen', 'Alpha', 'Beta', 'Delta'])
  })

  it('ignores the pin when no top-level folder matches', () => {
    const tree = buildFolderTree([R('b1', 'Beta'), R('b2', 'Alpha')], 'Other', 'Missing')
    expect(tree.map((n) => n.name)).toEqual(['Alpha', 'Beta'])
  })

  it('only pins at the top level, not in nested folders', () => {
    // "core" appears as a subfolder under two systems; pinning "core" must not
    // reorder those nested folders.
    const tree = buildFolderTree(
      [R('b1', 'SysB/zed'), R('b2', 'SysB/core'), R('b3', 'SysA/x')],
      'Other',
      'SysA'
    )
    expect(tree.map((n) => n.name)).toEqual(['SysA', 'SysB'])
    const sysB = tree.find((n) => n.name === 'SysB')
    expect(sysB.folders.map((f) => f.name)).toEqual(['core', 'zed'])
  })

  it('builds distinct paths for identically named leaf folders', () => {
    const tree = buildFolderTree([R('b1', 'a/core'), R('b2', 'b/core')], 'Other')
    const paths = tree.flatMap((n) => n.folders.map((f) => f.path))
    expect(paths.sort()).toEqual(['a/core', 'b/core'])
  })

  it('ignores empty path segments from leading/trailing slashes', () => {
    const tree = buildFolderTree([R('b1', '/core/')], 'Other')
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('core')
  })

  it('returns [] for no resources', () => {
    expect(buildFolderTree([], 'Other')).toEqual([])
  })
})

describe('nodeResources', () => {
  it('collects items from a node and all descendants', () => {
    const tree = buildFolderTree([R('b1', 'x'), R('b2', 'x/y')], 'Other')
    const ids = nodeResources(tree[0])
      .map((r) => r.resource_id)
      .sort()
    expect(ids).toEqual(['b1', 'b2'])
  })
})
