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
  return canonical({ colourCode: work.colourCode, elements: work.composition.elements })
}

/**
 * JSON с ключами по алфавиту. Версия возвращается из JSONB, а PostgreSQL
 * хранит ключи объекта в своём порядке: простое JSON.stringify видело правку
 * в каждой открытой версии, и «восстановить несохранённое?» спрашивало там,
 * где никто ничего не менял.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  }
  return JSON.stringify(value)
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

/** Строка истории: одна версия или свёрнутые автоверсии подряд. */
export type HistoryRow<V> = { kind: 'one'; version: V } | { kind: 'autos'; versions: V[] }

/**
 * Автоверсии, идущие подряд между ручными (две и больше), — одной строкой
 * (US-0599): версия руками важнее, и ручные не должны тонуть среди «перед
 * выгрузкой листа». Одна автоверсия стоит сама — сворачивать нечего.
 */
export function historyRows<V extends { auto_reason?: string | null }>(newestFirst: readonly V[]): HistoryRow<V>[] {
  const rows: HistoryRow<V>[] = []
  let run: V[] = []
  const close = () => {
    if (run.length >= 2) rows.push({ kind: 'autos', versions: run })
    else run.forEach((version) => rows.push({ kind: 'one', version }))
    run = []
  }
  for (const v of newestFirst) {
    if (v.auto_reason) run.push(v)
    else {
      close()
      rows.push({ kind: 'one', version: v })
    }
  }
  close()
  return rows
}
