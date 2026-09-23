// Сохранение композиции между сеансами.
//
// Сохраняется ВСЯ композиция, а не только ссылки на файлы: элементы, их
// положение в сантиметрах, цвета, шрифты. Этот формат и есть зародыш модели
// референса — если он рождается здесь, переход от стенда к карточке будет
// переносом данных, а не переписыванием.
//
// Лежит пока в браузере: у стенда нет ни карточек, ни субъектов, и заводить
// под него таблицу раньше, чем появятся те и другие, значит проектировать
// вслепую. Файлы при этом лежат НЕ здесь — они в хранилище, а тут только их
// имена по содержимому.

import type { Composition } from './composition'

const KEY = 'reference.bench.composition.v1'

export interface SavedState {
  readonly version: 1
  readonly stateCode: string
  readonly colourCode: string
  readonly composition: Composition
}

export function save(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Переполнение или запрет хранилища не должны ронять работу: потеря
    // сохранения — неприятность, потеря страницы — поломка.
  }
}

export function load(): SavedState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedState
    // Версия проверяется явно: формат ещё будет меняться, и старое состояние
    // лучше забыть, чем разобрать наполовину.
    return parsed.version === 1 ? parsed : null
  } catch {
    return null
  }
}

export function forget(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // см. выше
  }
}
