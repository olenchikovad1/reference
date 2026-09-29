// История изменений композиции: отмена и повтор.
//
// Держится на том, что композиция неизменяема (US-0420): каждое изменение —
// новый объект, поэтому «вернуться назад» значит взять предыдущий, а не
// восстанавливать состояние обратными действиями. Обратные действия пришлось бы
// писать на каждое изменение и на каждое новое — забывать.
//
// Настройки показа в историю НЕ входят. Ползунки подбора — не часть работы, и
// откат принта вместе с ними был бы неожиданностью.

export interface History<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

/** Сколько шагов помним. Хватает, чтобы вернуться к началу сеанса. */
export const DEPTH = 100

export function start<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Новое состояние. Всё, что было отменено, становится недостижимым. */
export function push<T>(h: History<T>, present: T): History<T> {
  if (present === h.present) return h
  const past = [...h.past, h.present].slice(-DEPTH)
  return { past, present, future: [] }
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0
}

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h
  const present = h.past[h.past.length - 1]
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h
  const [present, ...future] = h.future
  return { past: [...h.past, h.present], present, future }
}

/** Чья история: номер референса, null — новый, ещё не сохранённый. */
export type HistoryKey = number | null

/** Сколько чужих историй держим на сеанс — листают десятками, не сотнями. */
export const SHELF_DEPTH = 50

/** Перейти к истории другого референса (US-0683). Своя история кладётся на
 *  полку, чужая снимается с неё — если на полке лежит то же, что открыли;
 *  иначе (референс поменяли в другом месте) история начинается заново.
 *  Отмена поэтому никогда не приносит работу соседнего референса. */
export function switchTo<T>(
  shelf: ReadonlyMap<HistoryKey, History<T>>,
  key: HistoryKey,
  h: History<T>,
  next: HistoryKey,
  value: T,
  same: (a: T, b: T) => boolean,
): { shelf: Map<HistoryKey, History<T>>; h: History<T> } {
  const out = new Map(shelf)
  out.delete(key)
  out.set(key, h)
  while (out.size > SHELF_DEPTH) out.delete(out.keys().next().value as HistoryKey)
  const kept = out.get(next)
  out.delete(next)
  return { shelf: out, h: kept && same(kept.present, value) ? { ...kept, present: value } : start(value) }
}
