import { LuFolder, LuFolderOpen, LuFile, LuFileText } from 'react-icons/lu'

/**
 * The icon for one listing row.
 *
 * Container folders and indexed files get distinct glyphs so the two things that
 * change a move's consequences — "this folder declares a system" and "this file
 * carries metadata" — are visible without reading the badges.
 */
export default function EntryIcon({ entry }) {
  if (entry.is_dir)
    return entry.container_kind ? <LuFolderOpen size={15} /> : <LuFolder size={15} />
  return entry.record_id ? <LuFileText size={15} /> : <LuFile size={15} />
}
