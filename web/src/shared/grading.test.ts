// Градация по размерам: размерная сетка и то, как по ней меняется принт.
//
// Проверяется не арифметика, а то, от чего зависит печать: на 98 принт меньше,
// отцентрованный остаётся отцентрованным, правка на размере не ломает базу, а
// сетка отдельна от полей печати.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, type ImageElement } from './composition'
import { editAtSize, gradeOf, graded, resetAtSize, scaleAt, setScale, toBase, type SizeGrid } from './grading'

const GRID: SizeGrid = {
  provisional: true,
  base: 134,
  method: 'тест',
  by_size: { 98: 0.731, 134: 1, 164: 1.224 },
}

function picture(dxCm: number, dyCm: number, widthCm: number): ImageElement {
  return {
    id: 'п',
    kind: 'image',
    name: 'принт',
    src: '/x.png',
    aspect: 1,
    hasAlpha: true,
    placement: { side: 'front', anchor: 'neck', dxCm, dyCm, widthCm, rotation: 0 },
  }
}

describe('коэффициент по сетке', () => {
  it('без размера и на базовом — единица', () => {
    expect(gradeOf(GRID, null)).toBe(1)
    expect(gradeOf(GRID, 134)).toBe(1)
  })

  it('размер вне сетки — единица, а не выдуманное число', () => {
    // Выдумать коэффициент для размера, которого нет в сетке, — значит
    // отправить на фабрику принт неизвестно какого размера.
    expect(gradeOf(GRID, 110)).toBe(1)
  })
})

describe('принт на размере', () => {
  it('на 98 принт меньше, на 164 больше', () => {
    const c = add(EMPTY, picture(0, 12, 18))
    expect(graded(c, GRID, 98).elements[0].placement.widthCm).toBeCloseTo(13.16, 2)
    expect(graded(c, GRID, 164).elements[0].placement.widthCm).toBeCloseTo(22.03, 2)
  })

  it('положение идёт за изделием: 12 см от горловины на 134 — 8.8 на 98', () => {
    // Иначе принт, стоящий на груди на 134, на 98 уехал бы на живот.
    const c = add(EMPTY, picture(4, 12, 18))
    const p = graded(c, GRID, 98).elements[0].placement
    expect(p.dyCm).toBeCloseTo(8.77, 2)
    expect(p.dxCm).toBeCloseTo(2.92, 2)
  })

  it('исходная композиция не меняется', () => {
    // Размер — взгляд на работу, а не правка: переключение размера не должно
    // тихо переписать базу, от которой считаются все остальные.
    const c = add(EMPTY, picture(0, 12, 18))
    graded(c, GRID, 98)
    expect(c.elements[0].placement.widthCm).toBe(18)
  })
})

describe('правка на размере', () => {
  it('сдвиг и ширина на 98 переводятся в базу, а не пишутся как есть', () => {
    // Вписали на 98 «10 см от горловины» — в базе это 13.7: иначе после
    // возврата на 134 принт оказался бы не там, где его поставили.
    const patch = toBase({ dyCm: 10, widthCm: 16 }, GRID, 98)
    expect(patch.dyCm).toBeCloseTo(13.68, 2)
    expect(patch.widthCm).toBeCloseTo(21.89, 2)
  })

  it('без размера правка идёт как есть', () => {
    expect(toBase({ dxCm: 3 }, GRID, null)).toEqual({ dxCm: 3 })
  })
})

describe('коэффициент, вписанный на размере руками', () => {
  it('меняет только этот размер', () => {
    // На 98 по сетке ×0.731 — надпись мелкая, дизайнер ставит ×0.9. База и
    // остальные размеры при этом по сетке, как раньше.
    const el = picture(0, 12, 18)
    const p = { ...el.placement, ...setScale(el.placement, 98, 0.9) }
    const c = add(EMPTY, { ...el, placement: p })
    expect(c.elements[0].placement.widthCm).toBe(18)
    expect(graded(c, GRID, 98).elements[0].placement.widthCm).toBeCloseTo(16.2, 2)
    expect(graded(c, GRID, 164).elements[0].placement.widthCm).toBeCloseTo(22.03, 2)
    expect(graded(c, GRID, null).elements[0].placement.widthCm).toBe(18)
  })

  it('держится при правке базы: это коэффициент, а не сантиметры', () => {
    // «На 98 — ×0.9» остаётся ×0.9, когда базу сделали шире.
    const el = picture(0, 12, 18)
    const p = { ...el.placement, ...setScale(el.placement, 98, 0.9), widthCm: 20 }
    const c = add(EMPTY, { ...el, placement: p })
    expect(graded(c, GRID, 98).elements[0].placement.widthCm).toBeCloseTo(18, 2)
  })

  it('видно, что вручную, и какой был бы по сетке', () => {
    const el = picture(0, 12, 18)
    const p = { ...el.placement, ...setScale(el.placement, 98, 0.9) }
    expect(scaleAt(p, GRID, 98)).toEqual({ k: 0.9, manual: true, byGrid: 0.731 })
    expect(scaleAt(p, GRID, 164)).toEqual({ k: 1.224, manual: false, byGrid: 1.224 })
  })

  it('ширина, вписанная на размере, становится тем же коэффициентом', () => {
    // Вписали на 98 ширину 16.2 при базе 18 — это ×0.9, и хранится ×0.9.
    const el = picture(0, 12, 18)
    const patch = editAtSize(el.placement, { widthCm: 16.2 }, GRID, 98)
    expect(patch.widthCm).toBeUndefined()
    expect(patch.scaleBySize?.['98']).toBeCloseTo(0.9, 5)
  })

  it('снимается одним действием и возвращает размер к сетке', () => {
    const el = picture(0, 12, 18)
    const p = { ...el.placement, ...setScale(el.placement, 98, 0.9) }
    const back = { ...p, ...resetAtSize(p, 98) }
    expect(scaleAt(back, GRID, 98).manual).toBe(false)
    expect(graded(add(EMPTY, { ...el, placement: back }), GRID, 98).elements[0].placement.widthCm).toBeCloseTo(13.16, 2)
  })

  it('на базовом размере правка ширины меняет базу, а не пишет исключение', () => {
    const el = picture(0, 12, 18)
    const patch = editAtSize(el.placement, { widthCm: 20 }, GRID, 134)
    expect(patch.widthCm).toBe(20)
    expect(patch.scaleBySize).toBeUndefined()
  })

  it('положение на размере по-прежнему идёт в базу, а не в исключение', () => {
    const el = picture(0, 12, 18)
    const patch = editAtSize(el.placement, { dyCm: 10 }, GRID, 98)
    expect(patch.dyCm).toBeCloseTo(13.68, 2)
  })
})

describe('исключение принадлежит элементу', () => {
  it('у двух принтов на одном изделии исключения свои', () => {
    const a = picture(0, 12, 18)
    const b = { ...picture(0, 30, 10), id: 'другой' }
    const pa = { ...a.placement, ...setScale(a.placement, 98, 0.9) }
    const c = add(add(EMPTY, { ...a, placement: pa }), b)
    const on98 = graded(c, GRID, 98).elements
    expect(on98[0].placement.widthCm).toBeCloseTo(16.2, 2)
    expect(on98[1].placement.widthCm).toBeCloseTo(7.31, 2)
  })
})
