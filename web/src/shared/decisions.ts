// Что видно на полосе решений рабочего окна. Отдельно от окна и без React:
// здесь ровно то правило, которое нужно проверить на всех статусах, — кнопка
// показывается, только если её разрешают и роль (сервис присылает `can`),
// и право платформы. Иначе кнопка есть и отвечает отказом (US-0832).

import type { Status, Step } from './api/references'

/** Права платформы, от которых зависит полоса. Источник — useCan окна. */
export interface Rights {
  /** «Референсы: запись» — отправить, отозвать, перенести в дроп. */
  writeReferences: boolean
  /** «Согласование: запись» — решения редактора и замечания. */
  writeReview: boolean
  /** «Согласование: просмотр» — выдвинуть на обсуждение и снять. */
  viewReview: boolean
  /** Функция «Окончательное принятие». */
  approveFinal: boolean
}

/** Какое право платформы нужно шагу — то же, что объявляет его маршрут. */
const STEP_RIGHT: Record<Step, keyof Rights> = {
  submit: 'writeReferences',
  recall: 'writeReferences',
  return: 'writeReview',
  approve: 'writeReview',
  unapprove: 'writeReview',
  reject: 'writeReview',
  revive: 'writeReview',
  'approve-final': 'approveFinal',
}

export interface Decisions {
  /** Что делает «нравится»: согласовать, а согласованное — принять окончательно. */
  like: Step | null
  /** Уже согласован — «нравится» нажато. */
  liked: boolean
  canReturn: boolean
  /** Остальные переходы — в меню «статус». */
  menu: Step[]
  canRemark: boolean
  canPropose: boolean
  canMove: boolean
}

export function decisions(status: Status, can: (Step | 'remark')[], rights: Rights): Decisions {
  const steps = can.filter((w): w is Step => w !== 'remark' && rights[STEP_RIGHT[w]])
  const like: Step | null = steps.includes('approve')
    ? 'approve'
    : status === 'approved' && steps.includes('approve-final')
      ? 'approve-final'
      : null
  return {
    like,
    liked: status === 'approved' || status === 'final',
    canReturn: steps.includes('return'),
    menu: steps.filter((w) => w !== like && w !== 'return'),
    canRemark: can.includes('remark') && rights.writeReview,
    canPropose: rights.viewReview,
    canMove: rights.writeReferences,
  }
}

/** Куда переносить: действующие дропы, кроме тех, где референс уже лежит. */
export function moveTargets<D extends { id: number; retired: boolean }>(drops: D[], current: number[]): D[] {
  return drops.filter((d) => !d.retired && !current.includes(d.id))
}
