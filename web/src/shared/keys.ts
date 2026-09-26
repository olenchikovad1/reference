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
 * Ctrl+Shift+S — сохранить как, A и D — соседняя карточка витрины, Q и E —
 * история назад и вперёд (US-0630): все четыре под левой рукой и без
 * модификатора — Shift ради истории владелец отверг.
 *
 * Тоже по физической клавише: A и D в русской раскладке — «ф» и «в». Буквы
 * без модификаторов — только вне полей ввода: набирая «Дед Мороз», историю не
 * листают. Поле проверяет вызывающий — событие про фокус знает он.
 */
export function versionKey(
  e: KeyboardEvent,
): 'save' | 'save-as' | 'older' | 'newer' | 'prev-card' | 'next-card' | null {
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyS') return e.shiftKey ? 'save-as' : 'save'
    return null
  }
  if (e.altKey || e.shiftKey) return null
  if (e.code === 'KeyA') return 'prev-card'
  if (e.code === 'KeyD') return 'next-card'
  if (e.code === 'KeyQ') return 'older'
  if (e.code === 'KeyE') return 'newer'
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
  | { kind: 'card'; back: boolean }
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
  if (version === 'prev-card' || version === 'next-card') return { kind: 'card', back: version === 'prev-card' }
  return null
}

/** Строка подсказки «?» (US-0631). `probe` — нажатия, которыми тест сверяет
 *  строку с разбором клавиш: подсказка не должна обещать того, чего нет. */
export interface KeyRow {
  readonly keys: string
  readonly what: string
  readonly probe?: readonly { code: string; key?: string; shiftKey?: boolean; ctrlKey?: boolean }[]
}

/** Клавиши рабочего окна — всё, что оно умеет без мыши. */
export const WINDOW_KEYS: readonly KeyRow[] = [
  { keys: 'Tab / Shift+Tab', what: 'по объектам на холсте', probe: [{ code: 'Tab' }, { code: 'Tab', shiftKey: true }] },
  { keys: '← → ↑ ↓', what: 'сдвинуть выбранное на 1 мм, с Shift — на 1 см', probe: [{ code: 'ArrowLeft' }, { code: 'ArrowUp', shiftKey: true }] },
  { keys: 'Delete', what: 'убрать выбранное', probe: [{ code: 'Delete' }] },
  { keys: '+ / −', what: 'приблизить, отдалить', probe: [{ code: 'Equal' }, { code: 'Minus' }] },
  { keys: '0', what: 'вписать изделие в окно', probe: [{ code: 'Digit0' }] },
  { keys: '1 / 2 / 3', what: 'перед, спина, бок', probe: [{ code: 'Digit1' }, { code: 'Digit2' }, { code: 'Digit3' }] },
  { keys: 'A / D', what: 'соседняя карточка витрины', probe: [{ code: 'KeyA' }, { code: 'KeyD' }] },
  { keys: 'Q / E', what: 'история: раньше, позже', probe: [{ code: 'KeyQ' }, { code: 'KeyE' }] },
  { keys: 'Ctrl+Z / Ctrl+Y', what: 'отменить, вернуть', probe: [{ code: 'KeyZ', ctrlKey: true }, { code: 'KeyY', ctrlKey: true }] },
  { keys: 'Ctrl+S', what: 'сохранить новой версией', probe: [{ code: 'KeyS', ctrlKey: true }] },
  { keys: 'Ctrl+Shift+S', what: 'сохранить как новый референс', probe: [{ code: 'KeyS', ctrlKey: true, shiftKey: true }] },
  { keys: 'Esc', what: 'снять выбор; второй раз — закрыть окно', probe: [{ code: 'Escape', key: 'Escape' }] },
  { keys: '?', what: 'эта подсказка', probe: [{ code: 'Slash', key: '?', shiftKey: true }] },
]

/** Клавиши витрины. Перенос карточек — только мышью (владелец 26.09). */
export const SHOWCASE_KEYS: readonly KeyRow[] = [
  { keys: '← → ↑ ↓', what: 'по карточкам: вверх-вниз — в столбце, вбок — на соседний столбец' },
  { keys: 'Enter', what: 'открыть карточку' },
  { keys: 'Пробел', what: 'выделить карточку' },
  { keys: 'Ctrl + щелчок', what: 'добавить к выделенным или убрать' },
  { keys: 'Shift + щелчок', what: 'выделить от прошлой выделенной до этой' },
  { keys: 'зажать карточку или ⠿', what: 'перетащить мышью на другое место — порядок «мой»' },
  { keys: 'Ctrl+Z', what: 'вернуть прежний порядок' },
  { keys: '?', what: 'эта подсказка' },
]
