import {
  LuBook,
  LuBookOpen,
  LuScroll,
  LuClipboard,
  LuMap,
  LuFileText,
  LuWrench,
  LuPackage,
} from 'react-icons/lu'

export const CATEGORY_ORDER = [
  'core',
  'starter-set',
  'supplement',
  'adventure',
  'handout',
  'character-sheet',
  'map',
  'homebrew',
]

export const CATEGORY_LABELS = {
  core: 'Core Rulebooks',
  'starter-set': 'Starter Set',
  supplement: 'Supplements & Sourcebooks',
  adventure: 'Adventures & Modules',
  'character-sheet': 'Character Sheets',
  map: 'Maps',
  handout: 'Handouts & Reference',
  homebrew: 'Homebrew',
}

export const CATEGORY_ICONS = {
  core: LuBook,
  'starter-set': LuPackage,
  supplement: LuBookOpen,
  adventure: LuScroll,
  'character-sheet': LuClipboard,
  map: LuMap,
  handout: LuFileText,
  homebrew: LuWrench,
}
