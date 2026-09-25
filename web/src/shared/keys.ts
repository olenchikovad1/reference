// Клавиши истории правок: отмена и повтор.

/**
 * Что просит сочетание клавиш: отменить, повторить или ничего.
 *
 * По ФИЗИЧЕСКОЙ клавише (`code`), а не по букве (`key`): в русской раскладке
 * клавиша Z даёт «я», и сравнение с буквой молча не срабатывало — отмена не
 * работала у тех, кто печатает по-русски.
 */
export function historyKey(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey)) return null
  if (e.code === 'KeyZ') return e.shiftKey ? 'redo' : 'undo'
  // Ctrl+Y — повтор, как принято в Windows.
  if (e.code === 'KeyY') return 'redo'
  return null
}

/**
 * Что просит сочетание клавиш у версий референса (US-0490): Ctrl+S — сохранить,
 * Ctrl+Shift+S — сохранить как, A и D — листать историю назад и вперёд.
 *
 * Тоже по физической клавише: A и D в русской раскладке — «ф» и «в». Буквы
 * без модификаторов — только вне полей ввода: набирая «Дед Мороз», историю не
 * листают. Поле проверяет вызывающий — событие про фокус знает он.
 */
export function versionKey(e: KeyboardEvent): 'save' | 'save-as' | 'older' | 'newer' | null {
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyS') return e.shiftKey ? 'save-as' : 'save'
    return null
  }
  if (e.altKey || e.shiftKey) return null
  if (e.code === 'KeyA') return 'older'
  if (e.code === 'KeyD') return 'newer'
  return null
}

/** Что просит клавиша в рабочем окне референса (US-0492). */
export type WindowAction =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'save' }
  | { kind: 'save-as' }
  | { kind: 'older' }
  | { kind: 'newer' }
  | { kind: 'escape' }
  | { kind: 'help' }
  | { kind: 'view'; index: number }
  | { kind: 'zoom'; by: 'in' | 'out' | 'fit' }
  | { kind: 'nudge'; dxCm: number; dyCm: number }
  | { kind: 'remove' }
  | { kind: 'next'; back: boolean }

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * Клавиша окна → действие. Одна таблица на всё окно: разложенные по
 * обработчикам клавиши перебивали друг друга, и кто сработает, решал порядок
 * подписки.
 *
 * `typing` — фокус в поле ввода. Там буквы, цифры, стрелки и Delete печатают
 * и правят текст, а не листают историю и не двигают принт; работают только
 * Ctrl+S и Esc. По физической клавише (`code`), как Ctrl+Z: в русской раскладке
 * A — «ф», а искать её там никто не станет.
 */
export function windowKey(e: KeyboardEvent, typing: boolean): WindowAction | null {
  const version = versionKey(e)
  if (version === 'save' || version === 'save-as') return { kind: version }
  if (e.key === 'Escape') return { kind: 'escape' }
  if (typing) return null
  const history = historyKey(e)
  if (history) return { kind: history }
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) return { kind: 'help' }
  if (e.code === 'Tab') return { kind: 'next', back: e.shiftKey }
  if (e.code in NUDGE) {
    const step = e.shiftKey ? 1 : 0.1
    const [x, y] = NUDGE[e.code]
    return { kind: 'nudge', dxCm: x * step, dyCm: y * step }
  }
  if (e.code === 'Delete' || e.code === 'Backspace') return { kind: 'remove' }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') return { kind: 'zoom', by: 'in' }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return { kind: 'zoom', by: 'out' }
  if (e.code === 'Digit0' || e.code === 'Numpad0') return { kind: 'zoom', by: 'fit' }
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
  if (digit && !e.shiftKey) return { kind: 'view', index: Number(digit[1]) - 1 }
  if (version === 'older' || version === 'newer') return { kind: version }
  return null
}
