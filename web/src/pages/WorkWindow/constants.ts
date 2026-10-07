import { type Finding } from '../../shared/checks'

// Постоянные рабочего окна (план 114, US-0894): общие для состояния, действий и раскладки.

export const PRODUCT = 'B-HDY-14'
/** Предел отдаления — доля от «вписать в окно». */
export const MIN_ZOOM = 0.5

/** Лист для узнавания «такой принт уже был», точек на сантиметр. */
export const RECOGNITION_PX_PER_CM = 12

/** Сторона снимка для витрины, точек: карточка витрины меньше. */
export const VIEW_SIZE = 360

/** Ширина места под панель настроек справа на холсте — занято всегда. */
export const PANEL_SPACE = 344

/** Масштаб миниатюры стороны к кадру. Кадр — около тысячи точек, миниатюра
 *  на экране — меньше сотни; четверть оставляет запас на плотный экран. */
export const THUMB_SCALE = 0.25
export const noop = () => undefined

// Имена сторон по-русски. Коды уходят на фабрику, имена — человеку.
export const SIDE_NAMES: Record<string, string> = { front: 'перед', back: 'спина', left: 'левый бок' }
export type Overlay = 'none' | 'anchors' | 'zones' | 'all'
/** Находка проверки со стороной, на которой она. */
export type SideFinding = Finding & { side: string }
