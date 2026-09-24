// Печатное поле по размеру изделия.
//
// Поле и ЗОНА — разные вещи, и путать их нельзя. Зона нарисована на кадре: это
// куда физически можно печатать на том изделии, которое отрендерено. Поле — это
// сколько разрешено печатать на ДАННОМ размере, и приходит оно от технолога
// таблицей в сантиметрах.
//
// Пока таблица предварительная, и сказано это на экране, а не спрятано здесь:
// предварительное число, выданное за точное, хуже отсутствия числа — на него
// обопрутся.

import { type Calibration, cmToPx } from './geometry'
import type { Polygon } from './mask'

export interface PrintFields {
  readonly provisional: boolean
  readonly unit: string
  /** размер → сторона → [ширина, высота] в сантиметрах. */
  readonly by_size: Record<string, Record<string, number[]>>
}

/** Центр многоугольника по его габариту. */
function centreOf(poly: Polygon): [number, number] {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/**
 * Поле данного размера как прямоугольник на кадре.
 *
 * Возвращает null, когда для размера поля нет: таких размеров в таблице пять из
 * двенадцати. Выдумать их интерполяцией было бы легко и неверно — градация по
 * размерам не обязана быть линейной, и решает это технолог.
 */
export function fieldFor(
  fields: PrintFields | null,
  size: number,
  side: string,
  zone: Polygon | undefined,
  cal: Calibration,
): Polygon | null {
  const wh = fields?.by_size?.[String(size)]?.[side]
  if (!wh || wh.length < 2 || !zone || zone.length < 3) return null
  const [cx, cy] = centreOf(zone)
  const w = cmToPx(wh[0], cal) / 2
  const h = cmToPx(wh[1], cal) / 2
  return [
    [cx - w, cy - h],
    [cx + w, cy - h],
    [cx + w, cy + h],
    [cx - w, cy + h],
  ]
}

/** Размеры, для которых поле известно. Остальные названы человеку отдельно. */
export function sizesWithField(fields: PrintFields | null, side: string): number[] {
  if (!fields) return []
  return Object.entries(fields.by_size)
    .filter(([, sides]) => sides[side])
    .map(([size]) => Number(size))
    .sort((a, b) => a - b)
}

/**
 * Калибровка кадра для выбранного размера.
 *
 * Кадр один — отрисован на базовом размере, — но изделие на нём означает
 * изделие ВЫБРАННОГО размера. Во сколько раз оно больше базового, говорит
 * размерная сетка; во столько же раз меньше пикселей приходится на сантиметр.
 * Пересчёт всегда предварительный: сетка пока посчитана по росту.
 */
export function calibrationFor(base: Calibration, grade: number): Calibration {
  if (grade === 1) return base
  return { pxPerCm: base.pxPerCm / grade, provisional: true }
}

/** Поле размера [ширина, высота] в сантиметрах ткани. null — поля нет. */
export function fieldSize(
  fields: PrintFields | null,
  size: number | null,
  side: string,
): [number, number] | null {
  const wh = size === null ? null : fields?.by_size?.[String(size)]?.[side]
  return wh && wh.length >= 2 ? [wh[0], wh[1]] : null
}
