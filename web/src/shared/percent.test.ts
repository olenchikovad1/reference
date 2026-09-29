import { describe, expect, it } from 'vitest'

import { weightText } from './percent'

describe('проценты — только целые', () => {
  it('округляет, не уходит в научную запись и выше ста', () => {
    expect(weightText(0.974)).toBe('97 %')
    expect(weightText(1)).toBe('100 %')
    expect(weightText(1.02)).toBe('100 %')
    expect(weightText(0.0064)).toBe('1 %')
    expect(weightText(0.001)).toBe('<1 %')
  })
})
