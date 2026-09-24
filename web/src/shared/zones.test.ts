// Проверки по зонам кадра: печатное поле, линии, перекрытие капюшоном.
//
// Проверяется не «функция вернула находку», а то, от чего зависит решение
// человека: вес находки и названная доля. «Вышел на 2%» и «вышел наполовину» —
// разные решения, и принимает их он, а не мы.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, type ImageElement } from './composition'
import type { Calibration } from './geometry'
import { checkZones } from './zones'

const CAL: Calibration = { pxPerCm: 10, provisional: true }

// Поле 200×200 пикселей = 20×20 см при десяти пикселях на сантиметр.
const STATE = {
  code: 'front',
  kind: 'precise' as const,
  anchors: { neck: [100, 100] as [number, number] },
  zones: {
    print: [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ] as [number, number][],
  },
  lines: {
    zipper: [
      [100, 0],
      [100, 200],
    ] as [number, number][],
  },
}

function picture(id: string, dxCm: number, dyCm: number, widthCm: number): ImageElement {
  return {
    id,
    kind: 'image',
    name: id,
    src: `/x/${id}.png`,
    aspect: 1,
    hasAlpha: true,
    placement: { side: 'front', anchor: 'neck', dxCm, dyCm, widthCm, rotation: 0 },
  }
}

describe('печатное поле', () => {
  it('внутри поля находок нет', () => {
    // Якорь в (100,100); смещение -4 см даёт центр в x=60, элемент 4 см = 40 px
    // занимает 40..80 — внутри поля и НЕ задевая молнию, которая идёт по x=100.
    // Поставить его по центру было бы ошибкой набора, а не кода: по центру там
    // как раз молния.
    const c = add(EMPTY, picture('внутри', -4, 0, 4))
    expect(checkZones(c, STATE, CAL)).toEqual([])
  })

  it('выход за поле блокирует, а не предупреждает', () => {
    // Такой принт физически не печатается: за полем ткани под печать нет.
    const c = add(EMPTY, picture('вылез', 9, 0, 6))
    const found = checkZones(c, STATE, CAL)
    expect(found).toHaveLength(1)
    expect(found[0].weight).toBe('blocking')
    expect(found[0].elementId).toBe('вылез')
  })

  it('называет долю вышедшего, а не факт выхода', () => {
    // «Вышел на 2%» и «вышел наполовину» — разные решения.
    const c = add(EMPTY, picture('половина', 11, 0, 4))
    const [found] = checkZones(c, STATE, CAL)
    expect(found.message).toMatch(/%/)
  })

  it('элемент, вышедший дальше, даёт большую долю', () => {
    const мало = checkZones(add(EMPTY, picture('мало', 9, 0, 4)), STATE, CAL)
    const много = checkZones(add(EMPTY, picture('много', 11, 0, 4)), STATE, CAL)
    const доля = (s: string) => Number(s.match(/(\d+)\s*%/)?.[1] ?? 0)
    expect(доля(много[0].message)).toBeGreaterThan(доля(мало[0].message))
  })
})

describe('линии', () => {
  it('пересечение с молнией — отдельная находка', () => {
    // Причина другая, и делать с ней надо другое: принт через молнию
    // разрезается пополам, а не обрезается краем поля.
    const c = add(EMPTY, picture('через-молнию', 0, 5, 6))
    const found = checkZones(c, STATE, CAL)
    expect(found.map((f) => f.rule)).toContain('crosses-line')
  })

  it('не задевший молнию находки не даёт', () => {
    const c = add(EMPTY, picture('сбоку', -5, 5, 2), )
    const found = checkZones(c, STATE, CAL)
    expect(found.map((f) => f.rule)).not.toContain('crosses-line')
  })
})

describe('перекрытие капюшоном', () => {
  it('предупреждение, а не блокировка', () => {
    // Печатается нормально, просто не видно: решение за человеком.
    const withHood = {
      ...STATE,
      zones: { ...STATE.zones, hood: [[0, 0], [200, 0], [200, 60], [0, 60]] as [number, number][] },
    }
    const c = add(EMPTY, picture('под-капюшоном', 0, -6, 4))
    const found = checkZones(c, withHood, CAL)
    const hood = found.find((f) => f.rule === 'under-hood')
    expect(hood?.weight).toBe('warning')
  })
})
