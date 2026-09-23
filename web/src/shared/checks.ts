// Линтер референса: проверки, считаемые из геометрии в сантиметрах.
//
// Разрешение кадра на них не влияет вовсе — и это главное, что делает их
// осмысленными при семистах двадцати пикселях. Глазами на экране 0.5 мм от
// 0.25 мм не отличить, а арифметике всё равно.
//
// Печатные поля этим трём правилам не нужны: они про сам принт, а не про то,
// куда он помещается. Поэтому линтер начинает работать раньше, чем технолог
// пришлёт таблицу.

import type { Composition, PrintElement } from './composition'
import { heightCm } from './composition'

/** Блокирующая находка запрещает движение дальше; предупреждение — нет. */
export type Weight = 'blocking' | 'warning'

export interface Finding {
  readonly rule: string
  readonly weight: Weight
  /** Элемент, к которому находка относится. Пусто — находка про композицию. */
  readonly elementId: string | null
  readonly message: string
}

/**
 * Пороги лежат данными, а не в коде.
 *
 * У шелкографии и DTF они разные, и менять их будет технолог, а не
 * разработчик. Значения предварительные — взяты по обычной практике
 * шелкографии и подлежат уточнению.
 */
export interface Thresholds {
  /** Ниже этой высоты буква не пропечатается, сантиметры. */
  readonly minLetterCm: number
  /** Ниже этой высоты буква пропечатается плохо, сантиметры. */
  readonly warnLetterCm: number
  /** Тоньше этой линии не пропечатается, сантиметры. */
  readonly minStrokeCm: number
  /** Больше этого числа цветов — дорого: каждый цвет печатается отдельно. */
  readonly maxColours: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minLetterCm: 0.4,
  warnLetterCm: 0.6,
  minStrokeCm: 0.05,
  maxColours: 4,
}

/**
 * Высота буквы у надписи.
 *
 * Прописные занимают примерно семь десятых кегля — этого достаточно: правило
 * отвечает на «пропечатается или нет», а не меряет шрифт.
 */
export function letterHeightCm(el: PrintElement): number {
  return el.kind === 'text' ? heightCm(el) * 0.7 : 0
}

/** Толщина штриха: примерно шестая часть высоты буквы у плотных начертаний. */
export function strokeCm(el: PrintElement): number {
  return letterHeightCm(el) / 6
}

export function check(c: Composition, t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const found: Finding[] = []

  for (const el of c.elements) {
    if (el.kind !== 'text') continue
    const letter = letterHeightCm(el)
    if (letter < t.minLetterCm) {
      found.push({
        rule: 'letter-height',
        weight: 'blocking',
        elementId: el.id,
        message: `Буква ${(letter * 10).toFixed(1)} мм — ниже ${(t.minLetterCm * 10).toFixed(0)} мм не пропечатается`,
      })
    } else if (letter < t.warnLetterCm) {
      found.push({
        rule: 'letter-height',
        weight: 'warning',
        elementId: el.id,
        message: `Буква ${(letter * 10).toFixed(1)} мм — на грани, пропечатается неровно`,
      })
    }

    const stroke = strokeCm(el)
    if (stroke < t.minStrokeCm) {
      found.push({
        rule: 'stroke-width',
        weight: 'blocking',
        elementId: el.id,
        message: `Штрих ${(stroke * 10).toFixed(2)} мм — тоньше ${(t.minStrokeCm * 10).toFixed(1)} мм не пропечатается`,
      })
    }
  }

  // Цвета считаются по ОБЪЯВЛЕННОЙ палитре, а не угадываются квантованием
  // растра: сглаживание даёт ложные цвета, а в шелкографии палитра известна
  // заранее. Угаданное число дороже спрошенного.
  //
  // У картинок палитра пока не объявляется — и это названо прямо, а не
  // подменено догадкой: такая находка была бы хуже её отсутствия.
  const declared = new Set(
    c.elements.filter((e) => e.kind === 'text').map((e) => e.colourCode),
  )
  if (declared.size > t.maxColours) {
    found.push({
      rule: 'colour-count',
      weight: 'warning',
      elementId: null,
      message: `Цветов в надписях ${declared.size} при пороге ${t.maxColours} — каждый печатается отдельно`,
    })
  }

  const rasters = c.elements.filter((e) => e.kind === 'image').length
  if (rasters > 0) {
    found.push({
      rule: 'colour-count',
      weight: 'warning',
      elementId: null,
      message: `Цвета ${rasters} растровых элементов не посчитаны: палитра растра объявляется человеком, а не угадывается`,
    })
  }

  return found
}

export function blocking(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.weight === 'blocking')
}
