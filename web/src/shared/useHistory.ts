import { useCallback, useState } from 'react'

import { canRedo, canUndo, push, redo, start, switchTo, undo, type History, type HistoryKey } from './history'

// Состояние с историей.
//
// Живое изменение и запись в историю разведены сознательно: перетаскивание
// рождает десятки состояний в секунду, и складывая каждое, мы получили бы
// отмену, которая откатывает на полпикселя. Человек ждёт, что одно движение
// мышкой отменяется одним нажатием.
//
// Поэтому `set` меняет настоящее, не записывая, а `commit` закрепляет
// получившееся одним шагом. Тот, кто меняет, знает, где кончилось действие;
// история этого знать не может.
//
// `base` — значение на момент последнего закрепления — лежит В СОСТОЯНИИ, а не
// в ref. Это не украшение: React в строгом режиме вызывает обновление дважды,
// и запись в ref происходила бы в отброшенном прогоне. Первая отмена тогда не
// срабатывает вовсе, а выглядит это как ошибка где угодно, только не здесь.

interface Tracked<T> {
  readonly h: History<T>
  readonly base: T
  /** Чья это история и полка остальных (US-0683): у каждого референса своя. */
  readonly key: HistoryKey
  readonly shelf: ReadonlyMap<HistoryKey, History<T>>
}

export interface HistoryState<T> {
  readonly value: T
  /** Изменить, не записывая шаг. */
  set: (next: T | ((prev: T) => T)) => void
  /** Изменить и записать шаг. */
  commit: (next?: T | ((prev: T) => T)) => void
  undo: () => void
  redo: () => void
  /** Открыть работу референса `key`: другой референс — своя история, тот же
   *  — шаг в текущей (смена версии тоже отменяется). */
  open: (key: HistoryKey, value: T) => void
  readonly canUndo: boolean
  readonly canRedo: boolean
}

function apply<T>(next: T | ((prev: T) => T), prev: T): T {
  return typeof next === 'function' ? (next as (p: T) => T)(prev) : next
}

export function useHistoryState<T>(initial: T, same: (a: T, b: T) => boolean = Object.is): HistoryState<T> {
  const [state, setState] = useState<Tracked<T>>(() => ({ h: start(initial), base: initial, key: null, shelf: new Map() }))

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => ({ ...s, h: { ...s.h, present: apply(next, s.h.present) } }))
  }, [])

  const commit = useCallback((next?: T | ((prev: T) => T)) => {
    setState((s) => {
      const value = next === undefined ? s.h.present : apply(next, s.h.present)
      if (value === s.base) return { ...s, h: { ...s.h, present: value } }
      return { ...s, h: push({ ...s.h, present: s.base }, value), base: value }
    })
  }, [])

  const doUndo = useCallback(() => {
    setState((s) => {
      const h = undo({ ...s.h, present: s.base })
      return { ...s, h, base: h.present }
    })
  }, [])

  const doRedo = useCallback(() => {
    setState((s) => {
      const h = redo({ ...s.h, present: s.base })
      return { ...s, h, base: h.present }
    })
  }, [])

  const open = useCallback(
    (key: HistoryKey, value: T) => {
      setState((s) => {
        if (key === s.key) {
          if (value === s.base) return { ...s, h: { ...s.h, present: value } }
          return { ...s, h: push({ ...s.h, present: s.base }, value), base: value }
        }
        const { shelf, h } = switchTo(s.shelf, s.key, { ...s.h, present: s.base }, key, value, same)
        return { h, base: value, key, shelf }
      })
    },
    [same],
  )

  return {
    value: state.h.present,
    set,
    commit,
    undo: doUndo,
    redo: doRedo,
    open,
    canUndo: canUndo(state.h),
    canRedo: canRedo(state.h),
  }
}
