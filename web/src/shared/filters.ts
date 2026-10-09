// Один фильтр на страницах (US-0497, US-0889): дроп, адресат, вид одежды,
// плюс статус/исполнитель/ход/сезон на витрине и решение по дропу на принтах.
//
// Живёт в адресе — ссылку можно переслать, и у получателя то же. Переход на
// соседнюю страницу фильтр не теряет: последний заданный помнится на вкладку
// и подставляется в адрес страницы, открытой без своего.

import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { Status } from './api/references'

export type Audience = 'boys' | 'girls' | 'all'

export const AUDIENCE_NAMES: Record<Audience, string> = { boys: 'мальчики', girls: 'девочки', all: 'для всех' }

/** Сезон на витрине (US-0888/0889). Пусто в адресе — «в сезоне». */
export type SeasonFilter = 'in' | 'ending' | 'out'

export const SEASON_NAMES: Record<SeasonFilter, string> = {
  in: 'в сезоне',
  ending: 'кончается',
  out: 'вне сезона',
}

/** Решение принта в дропе (US-0889). */
export type DropDecision = 'approved' | 'rejected' | 'proposed'

export const DECISION_NAMES: Record<DropDecision, string> = {
  approved: 'одобрен в дропе',
  rejected: 'отклонён в дропе',
  proposed: 'не решено',
}

export interface DropFilter {
  drop: number | null
  audience: Audience | null
  category: string | null
  status: Status | null
  executor: string | null
  myTurn: boolean
  season: SeasonFilter | null
  decision: DropDecision | null
}

/** Что известно о предмете для фильтра: дропы, адресаты, виды одежды. */
export interface Placed {
  drops: readonly number[]
  audiences: readonly string[]
  categories: readonly string[]
}

/**
 * Проходит ли предмет фильтр.
 *
 * Адресат «мальчики» пропускает и сделанное «для всех»: оно и для мальчиков
 * тоже. Фильтр «для всех» — только сделанное для всех. Предмет без адресата
 * при заданном адресате не проходит: не знаем — не показываем как известное.
 */
export function passes(p: Placed, f: DropFilter): boolean {
  if (f.drop !== null && !p.drops.includes(f.drop)) return false
  if (f.audience !== null) {
    const ok = f.audience === 'all' ? p.audiences.includes('all') : p.audiences.some((a) => a === f.audience || a === 'all')
    if (!ok) return false
  }
  if (f.category !== null && !p.categories.includes(f.category)) return false
  return true
}

const MEMORY = 'reference.filter'
const KEYS = ['drop', 'audience', 'category', 'status', 'executor', 'my_turn', 'season', 'decision'] as const

const EMPTY: DropFilter = {
  drop: null,
  audience: null,
  category: null,
  status: null,
  executor: null,
  myTurn: false,
  season: null,
  decision: null,
}

const STATUSES: readonly Status[] = ['draft', 'review', 'rework', 'approved', 'final', 'rejected']

function read(params: URLSearchParams): DropFilter {
  const drop = Number(params.get('drop'))
  const audience = params.get('audience')
  const status = params.get('status')
  const season = params.get('season')
  const decision = params.get('decision')
  return {
    drop: drop > 0 ? drop : null,
    audience: audience === 'boys' || audience === 'girls' || audience === 'all' ? audience : null,
    category: params.get('category') || null,
    status: STATUSES.includes(status as Status) ? (status as Status) : null,
    executor: params.get('executor') || null,
    myTurn: params.get('my_turn') === '1',
    season: season === 'in' || season === 'ending' || season === 'out' ? season : null,
    decision: decision === 'approved' || decision === 'rejected' || decision === 'proposed' ? decision : null,
  }
}

function countOf(f: DropFilter): number {
  return (
    (f.drop !== null ? 1 : 0) +
    (f.audience !== null ? 1 : 0) +
    (f.category !== null ? 1 : 0) +
    (f.status !== null ? 1 : 0) +
    (f.executor !== null ? 1 : 0) +
    (f.myTurn ? 1 : 0) +
    (f.season !== null ? 1 : 0) +
    (f.decision !== null ? 1 : 0)
  )
}

/** Фильтр страницы: из адреса, с памятью между страницами. */
export function useDropFilter(): {
  filter: DropFilter
  set: (patch: Partial<DropFilter>) => void
  reset: () => void
  count: number
} {
  const [params, setParams] = useSearchParams()
  const filter = read(params)

  // Открыли без своего фильтра — берём последний заданный: переход с
  // «Принтов» на «Референсы» его не теряет.
  useEffect(() => {
    if (KEYS.some((k) => params.has(k))) {
      // Пришли ссылкой с фильтром — он и есть последний заданный.
      const own = new URLSearchParams()
      for (const k of KEYS) if (params.has(k)) own.set(k, params.get(k)!)
      try {
        sessionStorage.setItem(MEMORY, own.toString())
      } catch {
        // хранилище закрыто — живём без памяти
      }
      return
    }
    let remembered: string | null = null
    try {
      remembered = sessionStorage.getItem(MEMORY)
    } catch {
      // хранилище закрыто — живём без памяти
    }
    if (!remembered) return
    const next = new URLSearchParams(params)
    new URLSearchParams(remembered).forEach((v, k) => next.set(k, v))
    setParams(next, { replace: true })
  }, [])

  function write(f: DropFilter) {
    const next = new URLSearchParams(params)
    for (const k of KEYS) next.delete(k)
    if (f.drop !== null) next.set('drop', String(f.drop))
    if (f.audience !== null) next.set('audience', f.audience)
    if (f.category !== null) next.set('category', f.category)
    if (f.status !== null) next.set('status', f.status)
    if (f.executor !== null) next.set('executor', f.executor)
    if (f.myTurn) next.set('my_turn', '1')
    if (f.season !== null) next.set('season', f.season)
    if (f.decision !== null) next.set('decision', f.decision)
    const own = new URLSearchParams()
    for (const k of KEYS) if (next.has(k)) own.set(k, next.get(k)!)
    try {
      if (own.size) sessionStorage.setItem(MEMORY, own.toString())
      else sessionStorage.removeItem(MEMORY)
    } catch {
      // см. выше
    }
    setParams(next, { replace: true })
  }

  return {
    filter,
    set: (patch) => write({ ...filter, ...patch }),
    reset: () => write({ ...EMPTY }),
    count: countOf(filter),
  }
}
