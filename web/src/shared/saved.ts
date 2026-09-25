// Сохранение композиции между сеансами.
//
// Сохраняется ВСЯ композиция, а не только ссылки на файлы: элементы, их
// положение в сантиметрах, цвета, шрифты. Этот формат и есть зародыш модели
// референса — если он рождается здесь, переход от стенда к карточке будет
// переносом данных, а не переписыванием.
//
// Сохранённое в браузере — черновик: то, что на экране, пока не нажали
// «Сохранить». Версии референса живут в сервисе (US-0490); черновик нужен,
// чтобы закрытая вкладка не уносила правки, и при следующем открытии
// референса его предлагают восстановить. Файлы лежат НЕ здесь — они в
// хранилище, а тут только их имена по содержимому.

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
  /** Референс, к которому работа (US-0490). Нет — ещё ни разу не сохранена. */
  readonly referenceId?: number | null
  /** Версия, поверх которой правки. */
  readonly number?: number | null
}

/** Черновик референса лежит ещё и под своим номером: начатая с ячейки дропа
 *  новая работа перепишет общий ключ, а правки референса №12 должны дождаться,
 *  пока его откроют снова. */
const draftKey = (referenceId: number) => `reference.bench.draft.${referenceId}`

export function save(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    if (state.referenceId) localStorage.setItem(draftKey(state.referenceId), JSON.stringify(state))
  } catch {
    // Переполнение или запрет хранилища не должны ронять работу: потеря
    // сохранения — неприятность, потеря страницы — поломка.
  }
}

export function load(): SavedState | null {
  return read(KEY)
}

/** Несохранённое референса — то, что было на экране, когда его закрыли. */
export function loadDraft(referenceId: number): SavedState | null {
  return read(draftKey(referenceId))
}

/** Сохранили или отказались от правок — черновик больше не предлагать. */
export function forgetDraft(referenceId: number): void {
  try {
    localStorage.removeItem(draftKey(referenceId))
  } catch {
    // см. save
  }
}

function read(key: string): SavedState | null {
  try {
    const raw = localStorage.getItem(key)
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
