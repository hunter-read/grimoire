import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import api, { type Schema } from '../api'

type FavoriteItem = Schema<'FavoritesResponse'>['items'][number]

interface FavoritesContextValue {
  isFavorite: (type: string, id: string) => boolean
  toggleFavorite: (type: string, id: string) => Promise<void>
  items: FavoriteItem[]
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set()) // Set of "type:id" keys
  const [items, setItems] = useState<FavoriteItem[]>([]) // enriched items for FavoritesView

  const reload = useCallback(() => {
    api
      .get('/favorites')
      .then((data: Schema<'FavoritesResponse'>) => {
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

  const isFavorite = useCallback(
    (type: string, id: string) => favorites.has(`${type}:${id}`),
    [favorites]
  )

  const toggleFavorite = useCallback(
    async (type: string, id: string) => {
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

// Read outside a provider only by tests that mock this hook, so a missing
// provider is a programming error rather than a state to handle.
export const useFavorites = () => useContext(FavoritesContext) as FavoritesContextValue
