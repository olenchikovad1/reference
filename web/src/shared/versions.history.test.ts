// История версий (US-0599): автоверсии подряд сворачиваются, ручные — нет.

import { describe, expect, it } from 'vitest'

import { historyRows } from './versions'

const v = (number: number, auto?: string) => ({ number, auto_reason: auto ?? null })

describe('история версий', () => {
  it('две автоверсии подряд между ручными — одна строка', () => {
    const rows = historyRows([v(5), v(4, 'перед выгрузкой листа'), v(3, 'перед выгрузкой листа'), v(2), v(1)])
    expect(rows.map((r) => (r.kind === 'one' ? r.version.number : r.versions.map((x) => x.number)))).toEqual([
      5,
      [4, 3],
      2,
      1,
    ])
  })

  it('одна автоверсия стоит сама', () => {
    expect(historyRows([v(3), v(2, 'перед копиями'), v(1)]).every((r) => r.kind === 'one')).toBe(true)
  })

  it('автоверсии в самом верху тоже сворачиваются', () => {
    expect(historyRows([v(3, 'а'), v(2, 'б'), v(1)])[0].kind).toBe('autos')
  })
})
