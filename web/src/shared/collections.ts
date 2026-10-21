// Разработка коллекции (решение 0020): счёт и отбор на доске — без React и
// без запросов, чтобы проверялось тестом.

import type { Base, Collection, Label, Variant } from './api/collections'

/** Отбор доски: нажали на счётчик метки или на человека. */
export interface VariantFilter {
  /** id метки; 'none' — без метки. */
  label?: number | 'none'
  author?: string
  /** Только новое для меня: что случилось, пока меня не было. */
  fresh?: boolean
}

/** Варианты в работе: идеи и колонки цветов. Отложенное не считается —
 *  оно в подвале, а счётчики шапки — про живое. */
export function allVariants(bases: readonly Base[]): Variant[] {
  return bases.flatMap((b) => [...b.ideas, ...b.colours.flatMap((c) => c.variants)])
}

export function matches(v: Variant, f: VariantFilter): boolean {
  if (f.fresh && !v.is_new) return false
  if (f.label === 'none' && v.label_id !== null) return false
  if (typeof f.label === 'number' && v.label_id !== f.label) return false
  if (f.author !== undefined && v.author_id !== f.author) return false
  return true
}

/** Счётчики меток для шапки: «смотреть директору 6 · правки 3…». Считают в
 *  пределах отбора по человеку и «новому»: утром «мои» отвечают «согласовано
 *  3 · правки 2» про свои карточки, а не про всю коллекцию. Погашенная
 *  метка показывается, только пока стоит хоть на одной карточке. */
export function labelCounts(
  bases: readonly Base[],
  labels: readonly Label[],
  scope: VariantFilter = {},
): { label: Label | null; count: number }[] {
  const variants = allVariants(bases).filter((v) => matches(v, { author: scope.author, fresh: scope.fresh }))
  const count = (id: number | null) => variants.filter((v) => v.label_id === id).length
  const out: { label: Label | null; count: number }[] = [...labels]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((label) => ({ label, count: count(label.id) }))
    .filter((one) => one.label!.active || one.count > 0)
  out.push({ label: null, count: count(null) })
  return out
}

/** Кто кладёт варианты — и сколько у каждого. Свежие авторы не теряются в
 *  хвосте: больше вариантов — левее. */
export function authorsOf(bases: readonly Base[]): { id: string; name: string; count: number }[] {
  const by = new Map<string, { id: string; name: string; count: number }>()
  for (const v of allVariants(bases)) {
    if (!v.author_id) continue
    const one = by.get(v.author_id) ?? { id: v.author_id, name: v.author ?? v.author_id, count: 0 }
    one.count += 1
    by.set(v.author_id, one)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
}

export function newCount(bases: readonly Base[]): number {
  return allVariants(bases).filter((v) => v.is_new).length
}

/** Строка под названием коллекции: дроп, фабрика, продакт, бренд, пол.
 *  Пустое из PLM называется словами — «продакт не назначен», а не пропадает:
 *  пропавшее поле читается как «его здесь не бывает». */
export function headline(c: Collection): string {
  return [
    c.drop_code ? `дроп ${c.drop_code}` : 'дроп не проставлен',
    c.supplier ? `фабрика ${c.supplier}` : 'фабрика не указана',
    c.product ? `продакт ${c.product}` : 'продакт не назначен',
    c.brand,
    c.gender,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Картинки из вставки или броска: остальное (текст, PDF) отбрасывается
 *  сразу, а не уходит в сервис за отказом. */
export function imageFiles(files: Iterable<File>): File[] {
  return [...files].filter((f) => f.type.startsWith('image/'))
}

/** Колонка после переноса: `moved` встаёт перед `before` (null — в конец),
 *  из прежнего места уходит. Перенос на себя порядок не меняет. */
export function placeInto(ids: readonly number[], moved: number, before: number | null): number[] {
  if (moved === before) return [...ids]
  const rest = ids.filter((id) => id !== moved)
  const at = before === null ? -1 : rest.indexOf(before)
  if (at < 0) return [...rest, moved]
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** Сдвиг на одно место — кнопки «выше»/«ниже» для тех, кто без мыши. */
export function shifted(ids: readonly number[], id: number, step: -1 | 1): number[] {
  const at = ids.indexOf(id)
  const to = at + step
  if (at < 0 || to < 0 || to >= ids.length) return [...ids]
  const out = [...ids]
  ;[out[at], out[to]] = [out[to], out[at]]
  return out
}

/** Ход коллекции по цветам — «сколько релиза уже сделано» (Алиса 21.10).
 *
 * Цвет считается по самой дальней метке среди своих вариантов в работе;
 * «дальше» — ниже в справочнике меток: порядок там смысловой и задаётся людьми
 * («Смотреть директору» → «Правки» → «Согласовано» → «Отдано фабрике»).
 * Цвет без вариантов — «не начат», с вариантами без меток — «в работе».
 * Последняя метка справочника — «готово»: её доля и есть процент коллекции. */
export interface ColourProgress {
  colours: number
  untouched: number
  unlabelled: number
  byLabel: { label: Label; colours: number }[]
  /** Доля цветов на последней метке, 0…100, целым. */
  donePercent: number
}

export function colourProgress(bases: readonly Base[], labels: readonly Label[]): ColourProgress {
  const ordered = [...labels].sort((a, b) => a.position - b.position || a.id - b.id)
  const rank = new Map(ordered.map((l, i) => [l.id, i]))
  const reached = new Map<number, number>()
  let colours = 0
  let untouched = 0
  let unlabelled = 0
  for (const b of bases) {
    for (const c of b.colours) {
      colours += 1
      if (c.variants.length === 0) {
        untouched += 1
        continue
      }
      const best = c.variants
        .map((v) => (v.label_id !== null ? rank.get(v.label_id) : undefined))
        .filter((r): r is number => r !== undefined)
        .reduce((m, r) => Math.max(m, r), -1)
      if (best < 0) unlabelled += 1
      else reached.set(best, (reached.get(best) ?? 0) + 1)
    }
  }
  const done = ordered.length > 0 ? reached.get(ordered.length - 1) ?? 0 : 0
  return {
    colours,
    untouched,
    unlabelled,
    byLabel: ordered.map((label, i) => ({ label, colours: reached.get(i) ?? 0 })).filter((one) => one.colours > 0),
    donePercent: colours > 0 ? Math.round((done * 100) / colours) : 0,
  }
}
