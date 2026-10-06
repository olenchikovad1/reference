import { describe, expect, it } from 'vitest'

import { decisions, moveTargets, type Rights } from './decisions'

const ALL: Rights = { writeReferences: true, writeReview: true, viewReview: true, approveFinal: true }
const NONE: Rights = { writeReferences: false, writeReview: false, viewReview: false, approveFinal: false }

describe('полоса решений: что видно по статусу, роли и правам платформы', () => {
  it('на согласовании главный видит «нравится» = согласовать, «на доработку» и остальное в меню', () => {
    const d = decisions('review', ['approve', 'return', 'reject', 'remark'], ALL)
    expect(d.like).toBe('approve')
    expect(d.canReturn).toBe(true)
    expect(d.menu).toEqual(['reject'])
    expect(d.canRemark).toBe(true)
  })

  it('согласованное главному: «нравится» — принять окончательно, оно не дублируется в меню', () => {
    const d = decisions('approved', ['approve-final', 'unapprove', 'reject'], ALL)
    expect(d.like).toBe('approve-final')
    expect(d.liked).toBe(true)
    expect(d.menu).toEqual(['unapprove', 'reject'])
  })

  it('без функции «Окончательное принятие» кнопки нет — раньше она была и отвечала Not Found', () => {
    const d = decisions('approved', ['approve-final', 'unapprove'], { ...ALL, approveFinal: false })
    expect(d.like).toBeNull()
    expect(d.liked).toBe(true)
    expect(d.menu).toEqual(['unapprove'])
  })

  it('роль позволяет, а права записи в согласовании нет — ни решений, ни замечаний', () => {
    const d = decisions('review', ['approve', 'return', 'reject', 'remark'], { ...ALL, writeReview: false })
    expect(d.like).toBeNull()
    expect(d.canReturn).toBe(false)
    expect(d.menu).toEqual([])
    expect(d.canRemark).toBe(false)
  })

  it('дизайнеру без записи референсов не предлагается ни отправить, ни перенести в дроп', () => {
    const d = decisions('draft', ['submit'], { ...ALL, writeReferences: false })
    expect(d.menu).toEqual([])
    expect(d.canMove).toBe(false)
  })

  it('совсем без прав — только статус: ни одной кнопки, которая ответила бы отказом', () => {
    const d = decisions('review', ['approve', 'return', 'remark'], NONE)
    expect([d.like, d.canReturn, d.menu.length, d.canRemark, d.canMove, d.canPropose]).toEqual([
      null, false, 0, false, false, false,
    ])
  })
})

describe('перенос в дроп', () => {
  const drops = [
    { id: 1, name: 'Зима', retired: false },
    { id: 2, name: 'Весна', retired: false },
    { id: 3, name: 'Лето 2025', retired: true },
  ]

  it('нет ни дропа, где референс уже лежит, ни погашенного', () => {
    expect(moveTargets(drops, [1]).map((d) => d.name)).toEqual(['Весна'])
  })

  it('референс вне дропов — все действующие', () => {
    expect(moveTargets(drops, []).map((d) => d.name)).toEqual(['Зима', 'Весна'])
  })
})
