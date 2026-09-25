// Один фильтр на четырёх страницах (US-0497): дроп, адресат, вид одежды.
//
// Живёт в адресе — ссылку на «Новый год · мальчики» можно переслать, и у
// получателя то же. Переход на соседнюю страницу фильтр не теряет: последний
// заданный помнится на вкладку и подставляется в адрес страницы, открытой
// без своего.

import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export type Audience = 'boys' | 'girls' | 'all'

export const AUDIENCE_NAMES: Record<Audience, string> = { boys: 'мальчики', girls: 'девочки', all: 'для всех' }

export interface DropFilter {
  drop: number | null
  audience: Audience | null
  category: string | null
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
const KEYS = ['drop', 'audience', 'category'] as const

function read(params: URLSearchParams): DropFilter {
  const drop = Number(params.get('drop'))
  const audience = params.get('audience')
  return {
    drop: drop > 0 ? drop : null,
    audience: audience === 'boys' || audience === 'girls' || audience === 'all' ? audience : null,
    category: params.get('category') || null,
  }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function write(f: DropFilter) {
    const next = new URLSearchParams(params)
    for (const k of KEYS) next.delete(k)
    if (f.drop !== null) next.set('drop', String(f.drop))
    if (f.audience !== null) next.set('audience', f.audience)
    if (f.category !== null) next.set('category', f.category)
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
    reset: () => write({ drop: null, audience: null, category: null }),
    count: (filter.drop !== null ? 1 : 0) + (filter.audience !== null ? 1 : 0) + (filter.category !== null ? 1 : 0),
  }
}
