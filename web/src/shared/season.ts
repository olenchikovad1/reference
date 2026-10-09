// Сезон дропа для витрины (US-0888): профиль и окно продаж из недель PLM
// (intake/exit) или дат локального дропа. Метки Докроя пока не читаем —
// см. plans/notes/017-open-questions.md.

export type SeasonProfile = 'year_round' | 'seasonal' | 'sharp'

export const PROFILE_LABEL: Record<SeasonProfile, string> = {
  year_round: 'круглый год',
  seasonal: 'сезонный',
  sharp: 'остросезонный',
}

/** Сколько ISO-недель от intake до exit включительно; окно может через Новый год. */
export function weekSpan(intake: number, exit: number): number {
  if (intake <= exit) return exit - intake + 1
  return 53 - intake + 1 + exit
}

/** Профиль из окна ISO-недель PLM. Нет недель — круглый год: иначе витрина
 *  молча спрятала бы дропы без дат. */
export function profileFromWeeks(
  intake: number | null | undefined,
  exit: number | null | undefined,
): SeasonProfile {
  if (intake == null || exit == null) return 'year_round'
  const span = weekSpan(intake, exit)
  if (span >= 40) return 'year_round'
  // До ~4 месяцев — остросезонный (школа, 8 марта); иначе сезонный.
  if (span <= 16) return 'sharp'
  return 'seasonal'
}

export function weekInWindow(week: number, intake: number, exit: number): boolean {
  if (intake <= exit) return week >= intake && week <= exit
  return week >= intake || week <= exit
}

/** ISO-неделя даты (1…53). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // Четверг той же недели — в нужном ISO-году.
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

export function inSeasonWeeks(
  intake: number | null | undefined,
  exit: number | null | undefined,
  today: Date = new Date(),
): boolean {
  if (intake == null || exit == null) return true
  return weekInWindow(isoWeek(today), intake, exit)
}

/** Кончается: в сезоне и до exit ≤ 2 недель (US-0889). */
export function endingWeeks(
  intake: number | null | undefined,
  exit: number | null | undefined,
  today: Date = new Date(),
): boolean {
  if (intake == null || exit == null) return false
  if (!inSeasonWeeks(intake, exit, today)) return false
  const w = isoWeek(today)
  const left = exit >= w ? exit - w : exit + (53 - w)
  return left <= 2
}

export function endingDates(from: string, to: string, today: Date = new Date()): boolean {
  if (!inSeasonDates(from, to, today)) return false
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const left = (Date.parse(to + 'T00:00:00Z') - start) / 86_400_000
  return left >= 0 && left <= 14
}

/** Последний день ISO-недели exit в ISO-году даты `today` — «до 31.08». */
export function untilWeekLabel(exit: number, today: Date = new Date()): string {
  const year = isoWeekYear(today)
  const end = dateOfIsoWeek(year, exit, 7)
  const dd = String(end.getUTCDate()).padStart(2, '0')
  const mm = String(end.getUTCMonth() + 1).padStart(2, '0')
  return `до ${dd}.${mm}`
}

export function profileFromDates(from: string, to: string): SeasonProfile {
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 'year_round'
  const days = (b - a) / 86_400_000 + 1
  if (days >= 280) return 'year_round'
  if (days <= 112) return 'sharp'
  return 'seasonal'
}

export function inSeasonDates(from: string, to: string, today: Date = new Date()): boolean {
  const day = today.toISOString().slice(0, 10)
  return day >= from && day <= to
}

export function untilDateLabel(to: string): string {
  const d = new Date(to + 'T00:00:00Z')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `до ${dd}.${mm}`
}

function isoWeekYear(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  return t.getUTCFullYear()
}

/** День недели 1=пн … 7=вс ISO-недели `week` года `year`. */
function dateOfIsoWeek(year: number, week: number, day: number): Date {
  // 4 января всегда в первой ISO-неделе.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const monday1 = new Date(jan4)
  monday1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const out = new Date(monday1)
  out.setUTCDate(monday1.getUTCDate() + (week - 1) * 7 + (day - 1))
  return out
}
