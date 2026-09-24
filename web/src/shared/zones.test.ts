// Проверки по зонам кадра: печатное поле, линии, перекрытие капюшоном.
//
// Проверяется не «функция вернула находку», а то, от чего зависит решение
// человека: вес находки и названная доля. «Вышел на 2%» и «вышел наполовину» —
// разные решения, и принимает их он, а не мы.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, type ImageElement } from './composition'
import type { Calibration } from './geometry'
import { buildTorso } from './torso'
import { checkZones } from './zones'

const CAL: Calibration = { pxPerCm: 10, provisional: true }
const CAL_HOODIE: Calibration = { pxPerCm: 8.2, provisional: true }

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

describe('проверки по ткани, а не по кадру', () => {
  // Спина изделия: зона печати 248…472 по кадру. По ткани это шире, чем по
  // кадру, — край зоны ближе к боку, где ткань уходит от камеры.
  const BACK = {
    code: 'back',
    kind: 'precise' as const,
    anchors: { neck: [360, 178] as [number, number] },
    zones: {
      print: [
        [248, 180],
        [472, 180],
        [472, 505],
        [248, 505],
      ] as [number, number][],
    },
    lines: {},
  }
  const HOODIE_TORSO = buildTorso(
    {
      provisional: true,
      method: 'тест',
      side_seam_deg: 90,
      views: {
        front: { facing_deg: 0, centre_x: 360, half_px: 124, hem_y: 598 },
        back: { facing_deg: 180, centre_x: 358.5, half_px: 129.5, hem_y: 566 },
        left: { facing_deg: 90, hem_y: 592, rows: [[220, 301, 422], [580, 262, 452]] },
      },
    },
    8.2,
  )!
  const wide = (widthCm: number): ImageElement => ({
    ...picture('широкий', 0, 14, widthCm),
    placement: { side: 'back', anchor: 'neck', dxCm: 0, dyCm: 14, widthCm, rotation: 0 },
    aspect: 4,
  })
  const surface = { torso: HOODIE_TORSO, anchors: BACK.anchors }

  it('у края зоны плоский счёт видит выход, которого по ткани нет', () => {
    // Круглый торс радиусом 10 см при 10 px/см: масштаб на всех кадрах один, и
    // остаётся чистый изгиб. Зона ±95 пикселей — до 72° от центра. По кадру
    // это ±9.5 см, по ткани ±12.5: край зоны ближе к боку, ткань там уходит от
    // камеры. Принт в 22 см по ткани в зону входит, а плоский счёт видит 16%
    // вне её.
    const round = buildTorso(
      {
        provisional: true,
        method: 'тест',
        side_seam_deg: 90,
        views: {
          front: { facing_deg: 0, centre_x: 300, half_px: 100, hem_y: 500 },
          back: { facing_deg: 180, centre_x: 300, half_px: 100, hem_y: 500 },
          left: { facing_deg: 90, hem_y: 500, rows: [[100, 200, 400], [500, 200, 400]] },
        },
      },
      10,
    )!
    const state = {
      code: 'back',
      kind: 'precise' as const,
      anchors: { neck: [300, 200] as [number, number] },
      zones: { print: [[205, 150], [395, 150], [395, 450], [205, 450]] as [number, number][] },
      lines: {},
    }
    const el: ImageElement = {
      ...picture('широкий', 0, 0, 22),
      placement: { side: 'back', anchor: 'neck', dxCm: 0, dyCm: 10, widthCm: 22, rotation: 0 },
      aspect: 4,
    }
    const c = add(EMPTY, el)
    expect(checkZones(c, state, CAL).map((f) => f.rule)).toContain('out-of-print-field')
    const onFabric = checkZones(c, state, CAL, null, { torso: round, anchors: state.anchors })
    expect(onFabric.map((f) => f.rule)).not.toContain('out-of-print-field')
  })

  it('поле размера заменяет зону и меряется в сантиметрах ткани', () => {
    // Поле 34 см шире зоны кадра (29 по ткани). Принт 30 см в поле входит — и
    // находки нет, хотя по зоне, да ещё плоско, он бы «вышел».
    const c = add(EMPTY, wide(30))
    expect(checkZones(c, BACK, CAL_HOODIE).map((f) => f.rule)).toContain('out-of-print-field')
    const found = checkZones(c, BACK, CAL_HOODIE, null, { ...surface, fieldCm: [34, 40] })
    expect(found.map((f) => f.rule)).not.toContain('out-of-print-field')
  })

  it('выход за поле размера называет настоящую долю', () => {
    // Поле 28 см, принт 32 — выход настоящий, на восьмую часть площади.
    const c = add(EMPTY, wide(32))
    const found = checkZones(c, BACK, CAL_HOODIE, null, { ...surface, fieldCm: [28, 33] })
    const out = found.find((f) => f.rule === 'out-of-print-field')
    expect(out).toBeDefined()
    expect(Number(out!.message.match(/(\d+)%/)?.[1])).toBeGreaterThanOrEqual(10)
  })
})
