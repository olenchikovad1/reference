// Клиент файлов.

const BASE = import.meta.env.VITE_API_BASE ?? '/reference/api/'

export interface Derivative {
  name: string
  width: number
  height: number
  /** Ступень оказалась копией оригинала: он был мельче. */
  is_copy: boolean
}

export interface Asset {
  digest: string
  name: string
  content_type: string
  width: number
  height: number
  derivatives: Derivative[]
  reused: boolean
}

/** Хранилище отказало и сказало почему. Без причины — не ответило вовсе. */
export class UploadRefused extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(reason ?? `Загрузка: ${status}`)
  }
}

export async function uploadAssets(files: File[]): Promise<Asset[]> {
  const body = new FormData()
  // Несколько файлов одной операцией: по одному — та же работа, ради
  // устранения которой всё затевалось.
  for (const f of files) body.append('files', f)
  const r = await fetch(`${BASE}assets`, { method: 'POST', body })
  if (!r.ok) {
    // Отказ с причиной словами — её и показываем: «хранилище не ответило» про
    // файл, который просто слишком велик, увело бы человека не туда.
    const detail = await r.json().then((j) => j?.detail).catch(() => null)
    throw new UploadRefused(r.status, typeof detail === 'object' && detail?.reason ? detail.reason : null)
  }
  return (await r.json()) as Asset[]
}

/** Адрес ступени. Оригинал этим путём не отдаётся и в браузер не уходит. */
export function assetUrl(digest: string, preset: 'thumb' | 'preview'): string {
  return `${BASE}assets/${digest}/${preset}`
}

export interface Match {
  digest: string
  name: string
  similarity: number
  /** file — тот же ФАЙЛ, поймал хеш (мгновенно, без модели);
   *  same — та же КАРТИНКА, поймал вектор: файл другой, рисунок тот же;
   *  close — похожая по теме.
   *  Три случая, а не один: выводы из них разные, и сети разные. */
  level: 'file' | 'same' | 'close'
}

export interface Tag {
  code: string
  name: string
  /** Вес 0…1 — доля слова среди всех слов словаря. Решает человек, видя число. */
  score: number
  /** Сильный — среди первых десяти и не слабее заданной доли самого сильного.
   *  Где кончаются сильные, решает вес, а не число. */
  strong: boolean
  model: string
}

/** Что за изделие на картинке, и откуда это известно. */
export interface Named {
  name: string
  /** catalog — подпись в каталоге набора; inherited — от той же картинки.
   *  Незнакомое значение показывается как есть. */
  source: string
  from_digest: string | null
}

export interface Recognised {
  digest: string
  matches: Match[]
  /** Теги, поставленные сами. Пусто — модель ничего уверенно не увидела. */
  tags: Tag[]
  /** Нет — названия никто не знает. Догадки модели не бывает. */
  name: Named | null
}

export interface FileTags {
  tags: Tag[]
  name: Named | null
}

/** Теги уже лежащих файлов — без повторной загрузки картинок. */
export async function fetchTags(digests: string[]): Promise<Record<string, FileTags>> {
  if (digests.length === 0) return {}
  const r = await fetch(`${BASE}assets/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(digests),
  })
  if (!r.ok) throw new Error(`Теги: ${r.status}`)
  const rows = (await r.json()) as ({ digest: string } & FileTags)[]
  return Object.fromEntries(rows.map((x) => [x.digest, { tags: x.tags, name: x.name ?? null }]))
}

/** Узнавание. Отдельным запросом: модель считает около 90 мс на картинку, и
 * внутри загрузки это секунда ожидания на десятке файлов. Вызывающий этот
 * запрос НЕ ждёт — картинки уже на изделии, окно придёт, когда придёт. */
export async function recogniseAssets(digests: string[]): Promise<Recognised[]> {
  const r = await fetch(`${BASE}assets/recognise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(digests),
  })
  if (!r.ok) throw new Error(`Узнавание: ${r.status}`)
  return (await r.json()) as Recognised[]
}

/** Имя файла по содержимому из адреса ступени. Пусто — адрес не наш. */
export function digestOf(src: string): string {
  const m = src.match(/assets\/([0-9a-f]{64})\//)
  return m ? m[1] : ''
}

/** Кладёт уже готовый холст в хранилище и отдаёт его имя по содержимому. */
export async function uploadCanvas(canvas: HTMLCanvasElement, name: string): Promise<string> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('Холст не отдал картинку')
  const [asset] = await uploadAssets([new File([blob], name, { type: 'image/png' })])
  return asset.digest
}

/** Картинка, найденная словом. Вес — насколько она про запрос относительно
 *  всей библиотеки (в стандартных отклонениях); по нему и порядок. */
export interface Found {
  digest: string
  name: string
  similarity: number
  weight: number
  /** Карточки, где картинка стоит. */
  references: { id: number; name: string }[]
}

/** Поиск по смыслу слова (US-0480). Пустой ответ — «ничего не нашлось», а не
 *  ошибка: сервис не показывает слабую догадку первой строкой. */
export async function searchAssets(q: string): Promise<Found[]> {
  const r = await fetch(`${BASE}assets/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error(`поиск не ответил: ${r.status}`)
  return r.json()
}

/** Картинка библиотеки на странице «Принты» (US-0495). */
export interface LibraryItem {
  digest: string
  /** Имя последнего загруженного файла с таким содержимым. */
  file_name: string
  tags: Tag[]
  /** Что за изделие на картинке; нет — никто не знает. */
  name: Named | null
  /** «Где использован» — референсы с этой картинкой. */
  references: { id: number; name: string }[]
  drops: DropLink[]
  audiences: { code: string; via: number | null }[]
  categories: string[]
}

/** Связь с дропом: via пусто — назначен руками, номер — «через референс №…». */
export interface DropLink {
  id: number
  name: string
  retired: boolean
  via: number | null
  /** У предложенного — статус решения; у «через референс» пусто. */
  status: 'proposed' | 'approved' | 'rejected' | null
  reason: string | null
}

/** Назначить (или снять) дроп либо адресат нескольким разом. */
export interface LinksBody {
  keys: string[]
  drop_id?: number
  audience?: string
  remove?: boolean
}

export async function linkImages(body: LinksBody): Promise<void> {
  const r = await fetch(`${BASE}library/images/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`не назначилось: ${r.status}`)
}

/** Библиотека целиком, свежие первыми. */
export async function fetchLibrary(): Promise<LibraryItem[]> {
  const r = await fetch(`${BASE}assets/library`)
  if (!r.ok) throw new Error(`библиотека не ответила: ${r.status}`)
  return r.json()
}
