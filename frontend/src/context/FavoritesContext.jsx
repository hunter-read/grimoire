import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api'

const FavoritesContext = createContext(null)

export function FavoritesProvider({ children }) {
  const [favorites, setFavorites] = useState(new Set()) // Set of "type:id" keys
  const [items, setItems] = useState([]) // enriched items for FavoritesView

  const reload = useCallback(() => {
    api
      .get('/favorites')
      .then((data) => {
        setFavorites(new Set(data.favorites.map((f) => `${f.item_type}:${f.item_id}`)))
        setItems(data.items || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const isFavorite = useCallback((type, id) => favorites.has(`${type}:${id}`), [favorites])

  const toggleFavorite = useCallback(
    async (type, id) => {
      const key = `${type}:${id}`
      if (favorites.has(key)) {
        await api.delete(`/favorites/${type}/${id}`)
        setFavorites((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
        setItems((prev) => prev.filter((i) => !(i.item_type === type && i.item_id === id)))
      } else {
        await api.post('/favorites', { item_type: type, item_id: id })
        setFavorites((prev) => new Set([...prev, key]))
        reload() // re-fetch to get the enriched item data
      }
    },
    [favorites, reload]
  )

  return (
    <FavoritesContext.Provider value={{ isFavorite, toggleFavorite, items }}>
      {children}
    </FavoritesContext.Provider>
  )
}

export const useFavorites = () => useContext(FavoritesContext)
