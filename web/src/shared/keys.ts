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
