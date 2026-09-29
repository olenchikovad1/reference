// Кнопка — цветом по смыслу действия (US-0690), одной таблицей на всё
// приложение: экран говорит, ЧТО делает кнопка, а не какого она цвета.
// Правило платформы (её buttons.ts): цвет несёт смысл, громкость — вес.
//
//   agree    — согласие: принять, согласовать, отправить на согласование,
//              вернуть из корзины — положительный (кандидат, tones.css);
//   object   — возражение: вернуть на доработку, «нет, не то» — внимание;
//   withdraw — убрать обратимо: в корзину, выбросить черновик — отрицательный
//              вполголоса;
//   destroy  — необратимо: насовсем — отрицательный залитый;
//   act      — обычное изменяющее: поставить, сохранить в строке;
//   quiet    — ничего не меняет: отмена, копия на выбор, раскрыть.

import './tones.css'

import { buttonClass } from '@platform/ui'

export type Meaning = 'agree' | 'object' | 'withdraw' | 'destroy' | 'act' | 'quiet'

const LOOK: Record<Meaning, { tone: string; variant: 'solid' | 'soft' | 'outline' }> = {
  agree: { tone: 'positive', variant: 'solid' },
  object: { tone: 'attention', variant: 'soft' },
  withdraw: { tone: 'danger', variant: 'soft' },
  destroy: { tone: 'danger', variant: 'solid' },
  act: { tone: 'accent', variant: 'soft' },
  quiet: { tone: 'neutral', variant: 'outline' },
}

/** Классы кнопки по смыслу. `small` — внутри строки или карточки.
 *  `framed` — в рамке своего цвета, наведение подсвечивает рамку целиком
 *  (полоса решений окна, план 094). */
export function meaningClass(meaning: Meaning, small = false, framed = false): string {
  if (framed) return `${meaningClass(meaning, small).replace(/pf-btn--(solid|soft|outline)/, 'pf-btn--outline')} pf-btn--framed`
  const { tone, variant } = LOOK[meaning]
  // Положительного тона у платформы нет: класс собирается тем же образом,
  // pf-btn--positive задан в tones.css.
  if (tone === 'positive') return `pf-btn pf-btn--positive pf-btn--${variant}${small ? ' pf-btn--sm' : ''}`
  return buttonClass({ tone: tone as 'attention' | 'danger' | 'accent' | 'neutral', variant, small })
}
