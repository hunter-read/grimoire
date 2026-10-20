import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { characters as charactersApi } from '../../api'
import type { PortraitCharacter, PortraitPatch } from './characterMedia'

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

interface Options {
  character: PortraitCharacter
  onChanged: (patch: PortraitPatch) => void
  onError: (message: string) => void
}

/**
 * Uploading and removing a portrait, shared by every place that offers it -
 * the header thumbnail, a sheet's `<g-portrait>` and the art dialog - so they
 * cannot drift apart on what a change reports back.
 *
 * `inputRef` belongs on a hidden file input whose change calls `upload`.
 */
export default function usePortraitUpload({ character, onChanged, onError }: Options) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file?: File | null) => {
    if (!file) return
    setBusy(true)
    try {
      const result = (await charactersApi.uploadPortrait(character.id, file)) as {
        portrait_path: string
        portrait_version?: number | null
      }
      onChanged({
        portrait_path: result.portrait_path,
        // A version the browser has never cached, even if the server sent none.
        portrait_version: result.portrait_version || Date.now(),
        // A new picture starts centred; the server has dropped the old framing.
        portrait_crop: null,
      })
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
      // Cleared, so picking the same file again still uploads it.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  /** Resolves true once the art is gone, false if declined or failed. */
  const remove = async () => {
    const name = character.name || t('characters.untitled')
    if (!window.confirm(t('characters.confirmRemovePortrait', { name }))) return false
    setBusy(true)
    try {
      await charactersApi.deletePortrait(character.id)
      onChanged({ portrait_path: null, portrait_version: null, portrait_crop: null })
      return true
    } catch (e) {
      onError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const choose = () => inputRef.current?.click()

  return { inputRef, busy, upload, remove, choose }
}
