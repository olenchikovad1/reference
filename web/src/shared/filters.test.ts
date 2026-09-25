// Один фильтр на четырёх страницах (US-0497): что проходит и что нет.

import { describe, expect, it } from 'vitest'

import { passes, type DropFilter } from './filters'

const none: DropFilter = { drop: null, audience: null, category: null }
const tank = { drops: [1, 3], audiences: ['boys'], categories: ['Худи'] }
const teddy = { drops: [2], audiences: ['all'], categories: [] }

describe('фильтр по дропу, адресату, виду одежды', () => {
  it('без фильтра проходит всё', () => {
    expect(passes(tank, none)).toBe(true)
    expect(passes({ drops: [], audiences: [], categories: [] }, none)).toBe(true)
  })

  it('дроп — только его', () => {
    expect(passes(tank, { ...none, drop: 3 })).toBe(true)
    expect(passes(tank, { ...none, drop: 2 })).toBe(false)
  })

  it('«мальчики» пропускают и сделанное для всех, «для всех» — только его', () => {
    expect(passes(tank, { ...none, audience: 'boys' })).toBe(true)
    expect(passes(teddy, { ...none, audience: 'boys' })).toBe(true)
    expect(passes(tank, { ...none, audience: 'girls' })).toBe(false)
    expect(passes(tank, { ...none, audience: 'all' })).toBe(false)
    expect(passes({ drops: [], audiences: [], categories: [] }, { ...none, audience: 'boys' })).toBe(false)
  })

  it('вид одежды и сочетание условий', () => {
    expect(passes(tank, { drop: 1, audience: 'boys', category: 'Худи' })).toBe(true)
    expect(passes(tank, { drop: 1, audience: 'boys', category: 'Футболки' })).toBe(false)
  })
})
