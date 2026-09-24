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
import { upgrade } from './sides'

const KEY = 'reference.bench.composition.v1'

export interface SavedState {
  readonly version: 2
  readonly stateCode: string
  readonly colourCode: string
  /** Выбранный размер. Нет — база. */
  readonly size?: number | null
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
    // Разбирается как «что-то с номером версии», а не как текущий формат:
    // прочитанное на диске старее того, что описывает тип, и приводить одно к
    // другому до проверки версии значит проверять то, во что сам же и поверил.
    const parsed = JSON.parse(raw) as Omit<SavedState, 'version'> & { version: number }
    // Версия 1 не выбрасывается, а поднимается: в ней элементы лежат без
    // стороны, и это единственное отличие. Забыть её значило бы показать
    // человеку пустое изделие вместо его работы.
    if (parsed.version === 1) {
      return { ...parsed, version: 2, composition: upgrade(parsed.composition) }
    }
    // Через подъём идёт и текущая версия: в ней могли остаться повторы
    // номеров от счётчика, который после перезагрузки начинался заново.
    return parsed.version === 2
      ? { ...parsed, version: 2, composition: upgrade(parsed.composition) }
      : null
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
