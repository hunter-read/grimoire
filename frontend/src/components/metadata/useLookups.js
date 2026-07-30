import { useEffect, useState } from 'react'
import api from '../../api'

/**
 * Load the metadata lookup lists once for editor dropdowns: genres (tree),
 * system families, parent systems, licenses, and dice/materials. Returns the
 * lists plus `reload` to re-fetch after a custom value is created. Failures
 * degrade to empty lists (custom free-text entry still works).
 */
export default function useLookups() {
  const [genres, setGenres] = useState([])
  const [families, setFamilies] = useState([])
  const [parentSystems, setParentSystems] = useState([])
  const [licenses, setLicenses] = useState([])
  const [diceMaterials, setDiceMaterials] = useState([])

  const load = () => {
    api
      .get('/genres')
      .then((r) => setGenres(r.genres || []))
      .catch(() => setGenres([]))
    api
      .get('/system-families')
      .then((r) => setFamilies(r.families || []))
      .catch(() => setFamilies([]))
    api
      .get('/parent-systems')
      .then((r) => setParentSystems(r.parent_systems || []))
      .catch(() => setParentSystems([]))
    api
      .get('/licenses')
      .then((r) => setLicenses(r.licenses || []))
      .catch(() => setLicenses([]))
    api
      .get('/dice-materials')
      .then((r) => setDiceMaterials(r.dice_materials || []))
      .catch(() => setDiceMaterials([]))
  }

  useEffect(() => {
    load()
  }, [])

  return { genres, families, parentSystems, licenses, diceMaterials, reload: load }
}
