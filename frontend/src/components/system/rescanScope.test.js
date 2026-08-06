import { describe, it, expect } from 'vitest'
import { bookFolderScope, systemScope, groupScope } from './rescanScope'

const book = (relative_path) => ({ relative_path })

describe('bookFolderScope', () => {
  it('drops the filename', () => {
    expect(bookFolderScope(book('books/D&D 5e/adventure/Strahd/x.pdf'))).toBe(
      'books/D&D 5e/adventure/Strahd'
    )
  })

  it('normalises backslashes', () => {
    expect(bookFolderScope(book('books\\D&D 5e\\core\\x.pdf'))).toBe('books/D&D 5e/core')
  })
})

describe('systemScope', () => {
  it('scopes an ordinary system to its own folder', () => {
    expect(systemScope([book('books/D&D 5e/core/x.pdf')])).toBe('books/D&D 5e')
  })

  it('includes the system folder for a container child', () => {
    // Without the depth, this returned just "books/Dungeons & Dragons" — the
    // container — so rescanning 5e would re-scan every edition inside it.
    expect(systemScope([book('books/Dungeons & Dragons/5e/core/x.pdf')], 3)).toBe(
      'books/Dungeons & Dragons/5e'
    )
  })

  it('returns null when no book has a path', () => {
    expect(systemScope([{}, {}])).toBeNull()
    expect(systemScope([])).toBeNull()
  })

  it('returns null when the path is shallower than the system folder', () => {
    expect(systemScope([book('books/x.pdf')], 3)).toBeNull()
  })
})

describe('groupScope', () => {
  it('returns the deepest shared folder', () => {
    expect(groupScope([book('books/S/core/sub/a.pdf'), book('books/S/core/sub/b.pdf')])).toBe(
      'books/S/core/sub'
    )
  })

  it('stops at the common prefix when paths diverge', () => {
    expect(groupScope([book('books/S/core/a/x.pdf'), book('books/S/core/b/y.pdf')])).toBe(
      'books/S/core'
    )
  })

  it('keeps a container child category scoped below its system folder', () => {
    expect(
      groupScope(
        [book('books/D&D/5e/Monster Manuals/a.pdf'), book('books/D&D/5e/Monster Manuals/b.pdf')],
        3
      )
    ).toBe('books/D&D/5e/Monster Manuals')
  })

  it('falls back to the system scope when only the container is shared', () => {
    // Two editions of the same container share only "books/D&D", which is
    // shallower than the system folder and so not a usable scope.
    expect(
      groupScope([book('books/D&D/5e/core/a.pdf'), book('books/D&D/3.5e/core/b.pdf')], 3)
    ).toBe('books/D&D/5e')
  })

  it('returns null for an empty group', () => {
    expect(groupScope([])).toBeNull()
  })
})
