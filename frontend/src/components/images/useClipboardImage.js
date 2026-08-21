import { useEffect } from 'react'

// Image types the server accepts for every image target (banner, system cover,
// audio cover). A clipboard payload outside this set is ignored rather than
// sent, so the user gets nothing instead of a server-side rejection.
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * Extract the first acceptable image from a paste/drop DataTransfer.
 *
 * Screenshot tools and browsers put images on the clipboard as a `File` under
 * `items`, usually with no useful name, so a name is synthesised from the mime
 * type — the server keys stored files by target id and only reads the type.
 *
 * Returns a File, or null when the payload holds no usable image.
 */
export function imageFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || [])
  for (const item of items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && ACCEPTED.includes(file.type)) {
      // Clipboard files commonly arrive as "image.png" or unnamed; give it a
      // stable name so any filename-derived UI has something to show.
      return file.name
        ? file
        : new File([file], `pasted.${file.type.split('/')[1]}`, {
            type: file.type,
          })
    }
  }
  // Some sources (Windows apps, older Safari) populate `files` but not `items`.
  const files = Array.from(dataTransfer?.files || [])
  return files.find((f) => ACCEPTED.includes(f.type)) || null
}

/**
 * Call `onImage(file)` when an image is pasted while `active`.
 *
 * Bound to the document rather than an element because a modal rarely holds
 * focus on anything paste-able — the user just hits Ctrl/Cmd+V with the dialog
 * open, and no input inside it is focused. `active` lets a caller stand the
 * listener down while the dialog is closed or busy, so a paste meant for
 * something else on the page is never intercepted.
 */
export default function useClipboardImage(onImage, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const onPaste = (e) => {
      const file = imageFromDataTransfer(e.clipboardData)
      if (!file) return
      // Only claim the event once we know we have an image to handle, so a
      // plain text paste into a field inside the dialog still works.
      e.preventDefault()
      onImage(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [onImage, active])
}

export { ACCEPTED as ACCEPTED_IMAGE_TYPES }
