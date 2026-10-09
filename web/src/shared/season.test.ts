import { describe, expect, it } from 'vitest'

import {
  inSeasonDates,
  inSeasonWeeks,
  profileFromDates,
  profileFromWeeks,
  untilDateLabel,
  untilWeekLabel,
  weekSpan,
} from './season'

describe('профиль из недель PLM (US-0888)', () => {
  it('нет недель — круглый год', () => {
    expect(profileFromWeeks(null, null)).toBe('year_round')
    expect(profileFromWeeks(10, null)).toBe('year_round')
  })

  it('короткое окно — остросезонный, длинное — круглый год', () => {
    expect(weekSpan(22, 33)).toBe(12)
    expect(profileFromWeeks(22, 33)).toBe('sharp')
    // Школа demo PLM: недели 23–37.
    expect(profileFromWeeks(23, 37)).toBe('sharp')
    expect(profileFromWeeks(1, 30)).toBe('seasonal')
    expect(profileFromWeeks(1, 45)).toBe('year_round')
  })

  it('окно через Новый год считается по сумме хвостов', () => {
    expect(weekSpan(48, 8)).toBe(14)
    expect(profileFromWeeks(48, 8)).toBe('sharp')
  })
})


describe('в сезоне по неделям', () => {
  it('школа до недели 35 — 1 сентября (нед. 35) ещё внутри, неделя 36 снаружи', () => {
    // 2026-08-31 — понедельник недели 36; 2026-08-24 — понедельник 35.
    expect(inSeasonWeeks(22, 35, new Date('2026-08-24'))).toBe(true)
    expect(inSeasonWeeks(22, 35, new Date('2026-08-31'))).toBe(false)
  })

  it('подпись срока — последний день недели выхода', () => {
    expect(untilWeekLabel(35, new Date('2026-06-01'))).toBe('до 30.08')
  })
})

describe('локальные дропы по датам', () => {
  it('профиль и окно', () => {
    expect(profileFromDates('2026-06-01', '2026-08-31')).toBe('sharp')
    expect(inSeasonDates('2026-06-01', '2026-08-31', new Date('2026-09-01'))).toBe(false)
    expect(untilDateLabel('2026-08-31')).toBe('до 31.08')
  })
})
