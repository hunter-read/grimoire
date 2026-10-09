/**
 * The fields a book or system can send to GrimoireCodexDB (issue #35), in the
 * order the panel lists them. Mirrors `BOOK_SUBMIT_FIELDS` /
 * `SYSTEM_SUBMIT_FIELDS` in backend/codex/records.py: the server ignores any
 * other field, so this list only decides what is offered.
 */
export const CODEX_FIELDS = {
  books: [
    'title',
    'description',
    'category',
    'authors',
    'artists',
    'publisher',
    'publisher_url',
    'urls',
    'genres',
    'isbn',
    'product_code',
    'version',
    'language',
    'license',
    'year',
    'month',
    'day',
    'page_count',
    'tags',
    'is_explicit',
  ],
  systems: [
    'name',
    'description',
    'publishers',
    'urls',
    'character_builder_urls',
    'genres',
    'dice_materials',
    'system_family',
    'parent_system',
    'edition',
    'license',
    'year',
    'tags',
    'is_explicit',
    'is_system_agnostic',
    'is_one_page',
  ],
}

// Reuse the editors' own labels where they exist, so a field reads the same in
// the form and in the panel.
const BOOK_LABELS = {
  title: 'bookEditor.titleLabel',
  description: 'bookEditor.descriptionLabel',
  category: 'bookEditor.categoryLabel',
  authors: 'codex.fields.authors',
  artists: 'codex.fields.artists',
  publisher: 'bookEditor.publisherLabel',
  publisher_url: 'codex.fields.publisherUrl',
  urls: 'bookEditor.urlsLabel',
  genres: 'bookEditor.genresLabel',
  isbn: 'bookEditor.isbnLabel',
  product_code: 'bookEditor.productCodeLabel',
  version: 'bookEditor.versionLabel',
  language: 'bookEditor.languageLabel',
  license: 'bookEditor.licenseLabel',
  year: 'bookEditor.yearLabel',
  month: 'bookEditor.monthLabel',
  day: 'bookEditor.dayLabel',
  page_count: 'codex.fields.pageCount',
  tags: 'bookEditor.tagsLabel',
  is_explicit: 'codex.fields.explicit',
}

const SYSTEM_LABELS = {
  name: 'systemEditor.name',
  description: 'systemEditor.description',
  publishers: 'systemEditor.publishers',
  urls: 'systemEditor.urls',
  character_builder_urls: 'systemEditor.characterBuilderUrls',
  genres: 'systemEditor.genres',
  dice_materials: 'systemEditor.diceMaterials',
  system_family: 'systemEditor.systemFamily',
  parent_system: 'systemEditor.parentSystem',
  edition: 'systemEditor.edition',
  license: 'systemEditor.license',
  year: 'systemEditor.year',
  tags: 'systemEditor.tags',
  is_explicit: 'codex.fields.explicit',
  is_system_agnostic: 'codex.fields.systemAgnostic',
  is_one_page: 'codex.fields.onePage',
}

/** The label for `field` of `kind` ('books' | 'systems'), falling back to the field name. */
export function codexFieldLabel(t, kind, field) {
  const key = (kind === 'books' ? BOOK_LABELS : SYSTEM_LABELS)[field]
  return key ? t(key, field) : field
}
