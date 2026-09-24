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
