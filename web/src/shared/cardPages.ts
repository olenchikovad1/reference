// Карточки референсов на страницах вне витрины: взять их из того же списка,
// что и витрина, и открыть окно так, чтобы крестик вернул назад (US-0688).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { listReferences, type Card } from './api/references'
import { prefetchCard } from './cardCache'

/** Карточки витрины по номерам — из того же списка, что и витрина. */
export function useCards(): Map<number, Card> {
  const cards = useQuery({ queryKey: ['references'], queryFn: listReferences })
  return new Map((cards.data ?? []).map((c) => [c.id, c]))
}

/** Открыть окно поверх страницы: крестик вернёт на неё же. */
export function useOpen() {
  const navigate = useNavigate()
  const queries = useQueryClient()
  const open = (id: number) => navigate(`/references/${id}`, { state: { inApp: true } })
  open.warm = (id: number) => () => prefetchCard(queries, id)
  return open
}
