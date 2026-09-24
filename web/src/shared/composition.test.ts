import { describe, expect, it } from 'vitest'

import { EMPTY, add, find, heightCm, nudge, place, remove, select } from './composition'
import type { ImageElement } from './composition'

const tank = (id: string): ImageElement => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  src: `blob:${id}`,
  aspect: 2,
  hasAlpha: true,
  placement: { side: 'front', anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 20, rotation: 0 },
})

describe('состав композиции', () => {
  it('принимает несколько элементов, а не один', () => {
    const c = add(add(EMPTY, tank('a')), tank('b'))
    expect(c.elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('выбирает добавленный, чтобы его сразу можно было двигать', () => {
    expect(add(EMPTY, tank('a')).selectedId).toBe('a')
  })

  it('снимает выбор, когда убирают выбранный элемент', () => {
    const c = remove(add(EMPTY, tank('a')), 'a')
    expect(c.elements).toHaveLength(0)
    expect(c.selectedId).toBeNull()
  })

  it('оставляет выбор, когда убирают чужой элемент', () => {
    const c = remove(select(add(add(EMPTY, tank('a')), tank('b')), 'a'), 'b')
    expect(c.selectedId).toBe('a')
  })
})

describe('размещение', () => {
  it('высота следует за шириной и пропорцией исходника', () => {
    expect(heightCm(tank('a'))).toBe(10)
  })

  it('не правит композицию на месте: отмена держится на этом', () => {
    const before = add(EMPTY, tank('a'))
    const after = place(before, 'a', { dxCm: 5 })
    expect(before.elements[0].placement.dxCm).toBe(0)
    expect(after.elements[0].placement.dxCm).toBe(5)
    expect(after).not.toBe(before)
  })

  it('сдвигает на заданные сантиметры, а не на пиксели', () => {
    const c = nudge(add(EMPTY, tank('a')), 'a', 0, 0.1)
    expect(find(c, 'a')?.placement.dyCm).toBeCloseTo(12.1)
  })

  it('молча ничего не делает со сдвигом несуществующего элемента', () => {
    const c = add(EMPTY, tank('a'))
    expect(nudge(c, 'нет-такого', 1, 1)).toBe(c)
  })
})
