// Картинки принтов в памяти вкладки (US-0600): одна на все окна и карточки.
//
// Кэш жил в самом окне и умирал вместе с ним: закрыл карточку, открыл
// соседнюю — те же картинки качались и декодировались заново. Здесь картинка
// грузится один раз за вкладку, а витрина и соседние карточки греют её заранее.

type Listener = () => void

const images = new Map<string, HTMLImageElement>()
const listeners = new Set<Listener>()

/** Общий кэш: холст и печатный лист берут картинки отсюда. */
export const imageCache: ReadonlyMap<string, HTMLImageElement> = images

/** Начать грузить картинку, если её ещё нет. Догрузилась — слушатели узнают. */
export function warmImage(src: string): void {
  if (!src || images.has(src)) return
  const img = new Image()
  img.decoding = 'async'
  img.onload = () => listeners.forEach((l) => l())
  img.src = src
  images.set(src, img)
}

/** Подписаться на догрузку любой картинки; вернёт отписку. */
export function onImageLoad(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
