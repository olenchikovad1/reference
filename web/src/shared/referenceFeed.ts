import { useInfiniteQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { fetchReferenceOrder, fetchReferencePage, ReferenceReadError, type Card, type ReferenceFeedFilters, type ReferencePage } from './api/references'
import { ORDER_KEY } from './cardCache'
import { useSearchText } from './filters'

export const FEED_KEY = ['references', 'feed'] as const
const VIEW_FILTER_KEY = ['showcase-view-filters'] as const
const STORAGE = { sort: 'reference.showcase.sort', mine: 'reference.showcase.only-mine', drafts: 'reference.showcase.only-drafts' }

function stored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/** Все настройки текущего вида находятся в ссылке; память нужна только для первого входа. */
export function useShowcaseOptions() {
  const [params, setParams] = useSearchParams()
  const [defaults] = useState(() => ({
    sort: params.get('sort') ?? (stored(STORAGE.sort) === 'own' ? 'own' : 'date'),
    mine: params.get('mine') ?? (stored(STORAGE.mine) === '1' ? '1' : '0'),
    drafts: params.get('drafts') ?? (stored(STORAGE.drafts) === '1' ? '1' : '0'),
  }))
  const sortOwn = (params.get('sort') ?? defaults.sort) === 'own'
  const onlyMine = (params.get('mine') ?? defaults.mine) === '1'
  const onlyDrafts = (params.get('drafts') ?? defaults.drafts) === '1'
  const { query, setQuery, asked } = useSearchText()
  useEffect(() => {
    // Общий фильтр успевает восстановить свой адрес, затем добавляем его настройки,
    // используя фактический URL вместо устаревшего снимка двух соседних эффектов.
    queueMicrotask(() => {
      const next = new URLSearchParams(window.location.search)
      let changed = false
      for (const [key, value] of Object.entries(defaults)) if (!next.has(key)) { next.set(key, value); changed = true }
      if (changed) setParams(next, { replace: true })
    })
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE.sort, sortOwn ? 'own' : 'date')
      localStorage.setItem(STORAGE.mine, onlyMine ? '1' : '0')
      localStorage.setItem(STORAGE.drafts, onlyDrafts ? '1' : '0')
    } catch { /* Адрес остаётся источником текущего вида при запрете localStorage. */ }
  }, [sortOwn, onlyMine, onlyDrafts])
  const write = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search)
    next.set(key, value)
    setParams(next, { replace: true })
  }
  type Toggle = boolean | ((was: boolean) => boolean)
  return { query, setQuery, asked, sortOwn, onlyMine, onlyDrafts,
    setSortOwn: (value: boolean) => write('sort', value ? 'own' : 'date'),
    setOnlyMine: (value: Toggle) => write('mine', (typeof value === 'function' ? value(onlyMine) : value) ? '1' : '0'),
    setOnlyDrafts: (value: Toggle) => write('drafts', (typeof value === 'function' ? value(onlyDrafts) : value) ? '1' : '0'),
  }
}

export function useReferenceFeed(filters: ReferenceFeedFilters) {
  const queries = useQueryClient()
  const result = useInfiniteQuery({
    queryKey: [...FEED_KEY, filters] as const,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchReferencePage(filters, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 30_000,
    retry: (count, error) => count < 1 && !(error instanceof ReferenceReadError && error.status < 500),
    placeholderData: (previous, previousQuery) => {
      const old = previousQuery?.queryKey[2]
      return old && JSON.stringify({ ...old, sort: 'date' }) === JSON.stringify({ ...filters, sort: 'date' }) ? previous : undefined
    },
  })
  const items = useMemo(() => result.data?.pages.flatMap(page => page.items), [result.data])
  useEffect(() => {
    queries.setQueryData(VIEW_FILTER_KEY, filters)
  }, [filters, queries])
  useEffect(() => {
    if (!items) return
    // Старые потребители используют этот кэш только как справочник снимков.
    // Полный список для новой витрины при этом не запрашивается.
    queries.setQueryData<Card[]>(['references'], (previous) => {
      const all = new Map((previous ?? []).map(card => [card.id, card]))
      for (const card of items) all.set(card.id, card)
      return [...all.values()]
    })
  }, [items, queries])
  return { ...result, data: items, total: result.data?.pages[0]?.total ?? 0,
    isError: result.isError && !items?.length,
    loadMoreError: result.isFetchNextPageError ? result.error : null }
}

/** Полный набор номеров — только для явного перемещения или навигации. */
export async function fullOwnOrder(queries: QueryClient): Promise<number[]> {
  return queries.fetchQuery({ queryKey: ['references', 'order', 'all-own'],
    queryFn: ({ signal }) => fetchReferenceOrder({ sort: 'own' }, signal), staleTime: 0 })
}

export async function viewOrder(queries: QueryClient): Promise<number[]> {
  const filters = queries.getQueryData<ReferenceFeedFilters>(VIEW_FILTER_KEY) ?? {}
  const ids = await queries.fetchQuery({ queryKey: ['references', 'order', filters],
    queryFn: ({ signal }) => fetchReferenceOrder(filters, signal), staleTime: 30_000 })
  queries.setQueryData(ORDER_KEY, ids)
  return ids
}

export function patchReferencePositions(queries: QueryClient, order: number[]): void {
  const positions = new Map(order.map((id, index) => [id, index]))
  const update = (card: Card) => ({ ...card, my_position: positions.get(card.id) ?? null })
  queries.setQueryData<Card[]>(['references'], cards => cards?.map(update))
  queries.setQueriesData<InfiniteData<ReferencePage>>({ queryKey: FEED_KEY }, data => data && ({
    ...data, pages: data.pages.map(page => ({ ...page, items: page.items.map(update) })),
  }))
}
