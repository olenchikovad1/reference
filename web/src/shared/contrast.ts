// Читается ли принт на цвете изделия (US-0500): надпись белым на белой худи
// пропадает, и увидеть это надо при сравнении цветов, а не на фабрике.
//
// Мера — контраст по WCAG: отношение относительных яркостей. Для картинки
// берётся её средний цвет по непрозрачным точкам — грубо, но пропадающую
// картинку ловит: светлый принт на белом даёт контраст около единицы.

import type { Composition } from './composition'
import type { Finding } from './checks'

export type Rgb = readonly [number, number, number]

/** Относительная яркость цвета 0–255 по WCAG 2.1. */
export function luminanceOfRgb([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Контраст двух цветов: 1 — одинаковые, 21 — чёрный на белом. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminanceOfRgb(a), luminanceOfRgb(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Ниже — принт на изделии почти не виден. 1.5 предварительно: WCAG для
 *  крупного текста требует 3, но печать крупнее экранного текста, а цель —
 *  поймать пропадающее, а не придраться к бледному. */
export const LOW_CONTRAST = 1.5

/**
 * Элементы, которые на этом цвете изделия пропадают.
 *
 * `imageRgb` — средний цвет картинки по её адресу; неизвестен — картинка не
 * проверяется: догадка о цвете хуже молчания.
 */
export function lowContrast(
  c: Composition,
  garment: Rgb,
  garmentName: string,
  imageRgb: ReadonlyMap<string, Rgb>,
): Finding[] {
  return c.elements.flatMap((el) => {
    const rgb = el.kind === 'text' ? el.rgb : imageRgb.get(el.src)
    if (!rgb) return []
    const ratio = contrastRatio(rgb, garment)
    if (ratio >= LOW_CONTRAST) return []
    return [
      {
        rule: 'low-contrast',
        weight: 'warning' as const,
        elementId: el.id,
        message: `«${el.kind === 'text' ? el.text : el.name}» на цвете «${garmentName}» почти не виден: контраст ${ratio.toFixed(1)}`,
      },
    ]
  })
}
