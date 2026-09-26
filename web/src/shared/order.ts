// Свой порядок карточек витрины (US-0601): расставить, как удобно работать.
//
// Порядок хранится целиком, номерами от начала: перенос — это новый порядок,
// отмена — прежний. Здесь только арифметика над списками; куда тянут мышью и
// как это рисуется — на витрине.

export interface Placed {
  readonly id: number
  /** Место в своём порядке; нет — карточку ещё не расставляли. */
  readonly my_position?: number | null
}

/**
 * Свой порядок: не расставленные — в начале, как пришли (свежие первыми),
 * расставленные — по месту. Новая работа так не теряется в хвосте раскладки.
 */
export function ownOrder<T extends Placed>(cards: readonly T[]): T[] {
  const loose = cards.filter((c) => c.my_position == null)
  const placed = cards.filter((c) => c.my_position != null).sort((a, b) => a.my_position! - b.my_position!)
  return [...loose, ...placed]
}

/**
 * Перенести `moved` так, чтобы в ВИДИМОМ списке они встали на место `at` —
 * индекс среди видимых без переносимых. В полном порядке они встают между
 * теми же двумя соседями: фильтр прячет карточки, но не переставляет их.
 * Несколько переносимых идут подряд в прежнем порядке между собой.
 */
export function moveTo(
  full: readonly number[],
  visible: readonly number[],
  moved: readonly number[],
  at: number,
): number[] {
  const set = new Set(moved)
  const carried = full.filter((id) => set.has(id))
  const rest = full.filter((id) => !set.has(id))
  const shownRest = visible.filter((id) => !set.has(id))
  if (shownRest.length === 0) return [...carried, ...rest]
  const place = Math.max(0, Math.min(at, shownRest.length))
  const cut =
    place < shownRest.length ? rest.indexOf(shownRest[place]) : rest.indexOf(shownRest[shownRest.length - 1]) + 1
  return [...rest.slice(0, cut), ...carried, ...rest.slice(cut)]
}

/** Где сейчас стоят переносимые — индекс среди видимых без них. */
export function placeOf(visible: readonly number[], moved: readonly number[]): number {
  const set = new Set(moved)
  const first = visible.findIndex((id) => set.has(id))
  return first < 0 ? 0 : visible.slice(0, first).filter((id) => !set.has(id)).length
}

/** Видимый список с переносимыми на месте `at` — показ во время переноса:
 *  остальные раздвигаются, место под переносимые видно. */
export function preview<T extends { id: number }>(visible: readonly T[], moved: readonly number[], at: number): T[] {
  const set = new Set(moved)
  const carried = visible.filter((c) => set.has(c.id))
  const rest = visible.filter((c) => !set.has(c.id))
  const place = Math.max(0, Math.min(at, rest.length))
  return [...rest.slice(0, place), ...carried, ...rest.slice(place)]
}
