import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageCursor, PageResult } from '../services/tenant'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'

export function usePagedData<T>(
  loader: ((cursor?: PageCursor | null) => Promise<PageResult<T>>) | null,
  fallbackError: string
) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<PageCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    if (!loader) return
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const page = await loader(null)
      if (id !== requestId.current) return
      setItems(page.items)
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch (loadError) {
      if (id === requestId.current) setError(getFirebaseErrorMessage(loadError, fallbackError))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [fallbackError, loader])

  useEffect(() => {
    setItems([])
    setCursor(null)
    setHasMore(false)
    if (!loader) { setLoading(false); return }
    void reload()
    return () => { requestId.current += 1 }
  }, [loader, reload])

  const loadMore = useCallback(async () => {
    if (!loader || !cursor || loadingMore || !hasMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await loader(cursor)
      setItems((current) => [...current, ...page.items])
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch (loadError) {
      setError(getFirebaseErrorMessage(loadError, fallbackError))
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, fallbackError, hasMore, loader, loadingMore])

  return { items, loading, loadingMore, hasMore, error, setError, reload, loadMore }
}
