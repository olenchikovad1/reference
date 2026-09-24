// Калибровка по размеру: кадр один, а изделие на нём — выбранного размера.
//
// Проверяется то, что человек увидит: на маленьком размере тот же принт в
// сантиметрах ложится КРУПНЕЕ относительно изделия, на большом — мельче.

import { describe, expect, it } from 'vitest'

import { calibrationFor } from './fields'

const BASE = { pxPerCm: 8.2, provisional: true }

describe('калибровка по размеру', () => {
  it('без выбранного размера — та, что измерена на кадре', () => {
    expect(calibrationFor(BASE, 1).pxPerCm).toBe(8.2)
  })

  it('на отрисованном размере — та же самая', () => {
    expect(calibrationFor(BASE, 1).pxPerCm).toBeCloseTo(8.2)
  })

  it('на меньшем размере сантиметр занимает больше пикселей', () => {
    // Изделие 98 меньше, а кадр тот же: каждый сантиметр принта занимает на
    // нём большую долю — принт выглядит крупнее, и так оно и есть на ребёнке.
    expect(calibrationFor(BASE, 98 / 134).pxPerCm).toBeGreaterThan(8.2)
    expect(calibrationFor(BASE, 164 / 134).pxPerCm).toBeLessThan(8.2)
  })

  it('пересчёт всегда помечен предварительным', () => {
    // Он держится на допущении о пропорциональной градации, и выдавать его за
    // измеренное нельзя — на него обопрутся.
    expect(calibrationFor({ pxPerCm: 8.2, provisional: false }, 98 / 134).provisional).toBe(true)
  })
})
