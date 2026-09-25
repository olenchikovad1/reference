// Версии референса на странице (US-0490): что считается правкой и куда листать.

import type { Composition } from './composition'

/** Та часть работы, изменение которой — правка. */
export interface WorkShape {
  readonly colourCode: string
  readonly composition: Composition
}

/**
 * Отпечаток работы для сравнения «сохранено ли».
 *
 * Выбранный элемент, открытая сторона и выбранный размер — взгляд на работу,
 * а не правка: щёлкнуть по спине или выбрать размер 98 — не повод спрашивать
 * «сохранить?». В отпечаток идут элементы и цвет изделия.
 */
export function workKey(work: WorkShape): string {
  return JSON.stringify({ colourCode: work.colourCode, elements: work.composition.elements })
}

/**
 * Номер соседней версии или null, если листать некуда.
 *
 * Не «номер ± 1»: номера идут подряд сейчас, но опираться на это значит
 * сломаться в день, когда появится хоть одна дыра.
 */
export function neighbour(numbers: readonly number[], current: number, towards: 'older' | 'newer'): number | null {
  const at = numbers.indexOf(current)
  if (at < 0) return null
  const next = towards === 'older' ? at - 1 : at + 1
  return next >= 0 && next < numbers.length ? numbers[next] : null
}
