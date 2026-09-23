// Перевод сантиметров лекала в пиксели кадра и обратно.
//
// Это единственное место, где такой перевод происходит. Размещение хранится в
// сантиметрах от ориентира, а кадр меряется пикселями; если формулу разложить
// по экранам, она разойдётся, и разойдётся молча — принт просто окажется не там.

export type Point = readonly [number, number]

export interface Calibration {
  /** Сколько пикселей кадра приходится на сантиметр лекала. */
  readonly pxPerCm: number
  /** Число измерено или прикинуто. Пометка обязательна: см. схему на сервере. */
  readonly provisional: boolean
}

/** Сантиметры → пиксели. */
export function cmToPx(cm: number, c: Calibration): number {
  return cm * c.pxPerCm
}

/** Пиксели → сантиметры. */
export function pxToCm(px: number, c: Calibration): number {
  return px / c.pxPerCm
}

/**
 * Где на кадре окажется точка, заданная смещением от ориентира в сантиметрах.
 *
 * Ось Y смотрит вниз, как в кадре: «12 см ниже горловины» — это плюс двенадцать.
 */
export function pointFromAnchor(
  anchor: Point,
  offsetCm: { readonly x: number; readonly y: number },
  c: Calibration,
): Point {
  return [anchor[0] + cmToPx(offsetCm.x, c), anchor[1] + cmToPx(offsetCm.y, c)]
}

/** Обратное: смещение точки кадра от ориентира, в сантиметрах. */
export function offsetFromAnchor(
  anchor: Point,
  point: Point,
  c: Calibration,
): { x: number; y: number } {
  return { x: pxToCm(point[0] - anchor[0], c), y: pxToCm(point[1] - anchor[1], c) }
}

/** Сантиметры для показа человеку: один знак после запятой, миллиметры видны. */
export function formatCm(cm: number): string {
  return `${cm.toFixed(1)} см`
}
