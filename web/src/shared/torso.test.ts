// Модель торса: сантиметры по ткани ↔ пиксели кадра на любом ракурсе.
//
// Проверяется то, что увидит человек: край принта со спины виден на боку, у
// края кадра принт сжат, центр спины не виден спереди, и перевод туда-обратно
// возвращает ту же точку.

import { describe, expect, it } from 'vitest'

import { arcLength, buildLookup, buildTorso, toFrame, toSurface, type TorsoData } from './torso'

// Круглый торс радиусом 10 см при 10 px/см — числа проверяются в уме.
const ROUND: TorsoData = {
  provisional: true,
  method: 'тест',
  side_seam_deg: 90,
  views: {
    front: { facing_deg: 0, centre_x: 300, half_px: 100, hem_y: 500 },
    back: { facing_deg: 180, centre_x: 300, half_px: 100, hem_y: 500 },
    left: { facing_deg: 90, hem_y: 500, rows: [[100, 200, 400], [500, 200, 400]] },
  },
}

// Как у изделия: шире, чем глубже, и спина на кадре крупнее переда.
const HOODIE: TorsoData = {
  provisional: true,
  method: 'тест',
  side_seam_deg: 90,
  views: {
    front: { facing_deg: 0, centre_x: 360, half_px: 124, hem_y: 598 },
    back: { facing_deg: 180, centre_x: 358.5, half_px: 129.5, hem_y: 566 },
    left: { facing_deg: 90, hem_y: 592, rows: [[220, 301, 422], [580, 262, 452]] },
  },
}

describe('длина по ткани', () => {
  it('четверть круга — это четверть окружности', () => {
    const t = buildTorso(ROUND, 10)!
    expect(arcLength(t, 20, Math.PI / 2)).toBeCloseTo((Math.PI * 10) / 2, 1)
  })

  it('у эллипса дуга до бока лежит между полуосями, умноженными на π/2', () => {
    const t = buildTorso(HOODIE, 8.2)!
    const quarter = arcLength(t, 20, Math.PI / 2)
    // Нижняя граница — меньшая полуось, верхняя — большая.
    expect(quarter).toBeGreaterThan((Math.PI / 2) * 11)
    expect(quarter).toBeLessThan((Math.PI / 2) * 15.2)
  })
})

describe('перевод кадр ↔ ткань', () => {
  it('центр переда — нулевая точка ткани', () => {
    const t = buildTorso(ROUND, 10)!
    const s = toSurface(t, 'front', 300, 300)!
    expect(s.uFront).toBeCloseTo(0, 5)
    expect(s.h).toBeCloseTo(20, 5)
  })

  it('край силуэта на переде — это бок, четверть окружности по ткани', () => {
    const t = buildTorso(ROUND, 10)!
    const s = toSurface(t, 'front', 399.999, 300)!
    expect(s.uFront).toBeCloseTo((Math.PI * 10) / 2, 1)
  })

  it('туда и обратно — та же точка на всех трёх кадрах', () => {
    const t = buildTorso(HOODIE, 8.2)!
    for (const [view, x] of [
      ['front', 420],
      ['back', 300],
      ['left', 330],
    ] as const) {
      const s = toSurface(t, view, x, 400)!
      const panel = s.flags & 1 ? 'front' : 'back'
      const u = panel === 'front' ? s.uFront : s.uBack
      const back = toFrame(t, view, panel, u, s.h)!
      expect(back.visible).toBe(true)
      expect(back.x).toBeCloseTo(x, 3)
      expect(back.y).toBeCloseTo(400, 3)
    }
  })

  it('вне торса — не ткань', () => {
    const t = buildTorso(HOODIE, 8.2)!
    expect(toSurface(t, 'front', 100, 400)).toBeNull()
  })
})

describe('то, ради чего всё', () => {
  it('принт у края спины, ушедший за плоскую ширину, виден на боку', () => {
    // На плоском кадре спины видно 15.8 см от центра; 18 см по ткани — уже за
    // краем. Раньше это обрезалось. Теперь это видно на левом боку, в задней
    // его части — справа от середины кадра.
    const t = buildTorso(HOODIE, 8.2)!
    const onBack = toFrame(t, 'back', 'back', -18, 30)!
    const onSide = toFrame(t, 'left', 'back', -18, 30)!
    expect(onSide.visible).toBe(true)
    expect(onSide.x).toBeGreaterThan(357)
    // На кадре спины та же точка тоже видна — у самого края, слева.
    expect(onBack.visible).toBe(true)
    expect(onBack.x).toBeLessThan(358.5 - 120)
  })

  it('принт у левого края переда виден на боку спереди', () => {
    const t = buildTorso(HOODIE, 8.2)!
    const onSide = toFrame(t, 'left', 'front', 18, 30)!
    expect(onSide.visible).toBe(true)
    expect(onSide.x).toBeLessThan(357)
  })

  it('центр спины спереди не виден', () => {
    const t = buildTorso(HOODIE, 8.2)!
    expect(toFrame(t, 'front', 'back', 0, 30)!.visible).toBe(false)
  })

  it('у края кадра принт сжат: тот же шаг по ткани даёт меньше пикселей', () => {
    // Ткань у края уходит от камеры. Плоский перевод этого не видел и рисовал
    // край принта той же ширины, что середину.
    const t = buildTorso(HOODIE, 8.2)!
    const px = (u: number) => toFrame(t, 'back', 'back', u, 30)!.x
    const middle = Math.abs(px(2) - px(0))
    const edge = Math.abs(px(20) - px(18))
    expect(edge).toBeLessThan(middle * 0.6)
  })
})

describe('карта для шейдера', () => {
  it('центр переда — только перед; вне торса — ничего', () => {
    // Центр спины на переде дал бы шов ткани посреди груди: координата спинки
    // там разрывается. Поэтому спинка на центре переда просто не допускается.
    const t = buildTorso(HOODIE, 8.2)!
    const W = 720
    const map = buildLookup(t, 'front', W, 720, 1)
    const at = (x: number, y: number) => map[(y * W + x) * 4 + 3]
    expect(at(360, 400)).toBe(1)
    expect(at(50, 400)).toBe(0)
  })
})
