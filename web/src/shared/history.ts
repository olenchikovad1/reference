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
