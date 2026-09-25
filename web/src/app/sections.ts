// Разделы приложения: где каждый живёт и какой пункт меню подсвечен.
//
// Состав и коды — те же, что в manifest.reference.yaml: платформа знает, что
// раздел есть и кому он открыт, а где он живёт, знаем только мы. ЧТО показать в
// меню, решает платформа (разделы, права на которые не выданы, не приходят
// вовсе); здесь — только адреса.

/** Приставка приложения: шлюз путь не срезает, маршрут /prints отвечает на
 *  /reference/prints. Роутер подставляет её сам. */
export const BASE = '/reference'

export interface Subsection {
  code: string
  path: string
}

export interface SectionPlace {
  code: string
  path: string
  children: Subsection[]
  /** Где страницу сделают — для заглушки со смыслом. */
  plan: string
  /** Что здесь будет — одной фразой, для заглушки. */
  about: string
  /** Имя — только для стенда без платформы. В рамке имя приходит от
   *  платформы, из манифеста: там оно главное. */
  title: string
}

export const HOME_PATH = '/'

export const SECTIONS: SectionPlace[] = [
  { code: 'references', title: 'Референсы', path: '/references', plan: 'план 073 (US-0491)',
    about: 'Витрина референсов: все работы карточками, фильтр по дропу и адресату, большое рабочее окно поверх.',
    children: [{ code: 'trash', path: '/references/trash' }] },
  { code: 'prints', title: 'Принты', path: '/prints', plan: 'план 073 (US-0495)',
    about: 'Принты библиотеки: где каждый использован, свои теги рядом с автотегами, поиск по смыслу.', children: [] },
  { code: 'texts', title: 'Тексты', path: '/texts', plan: 'план 073 (US-0496)',
    about: 'Тексты и слоганы: что уже писали, в каких референсах и дропах.', children: [] },
  { code: 'products', title: 'Изделия', path: '/products', plan: 'позже',
    about: 'Изделия: состояния, печатные поля по размерам, размерная сетка — то, что заводит технолог.', children: [] },
  { code: 'drops', title: 'Дропы', path: '/drops', plan: 'план 073 (US-0489)',
    about: 'Дропы и их ассортимент матрицей «модели × цвета».', children: [] },
  { code: 'review', title: 'Согласование', path: '/review', plan: 'план 075 (US-0510)',
    about: 'Согласование: чей ход, замечания на слоях и версиях, голосом тоже.',
    children: [{ code: 'my-tasks', path: '/review/my-tasks' }] },
  { code: 'dictionaries', title: 'Справочники', path: '/dictionaries', plan: 'план 073',
    about: 'Справочники: товарная иерархия, адресаты, палитра.', children: [] },
  { code: 'archive', title: 'Архив', path: '/archive', plan: 'позже',
    about: 'Архив: итоги выпущенного, только чтение.', children: [] },
]

const byCode = new Map(SECTIONS.map((s) => [s.code, s]))

/** Адрес раздела для рамки — с приставкой. null — экрана в этой сборке нет. */
export function hrefOfCode(code: string): string | null {
  const s = byCode.get(code)
  return s ? BASE + s.path : null
}

export function hrefOfChild(section: string, child: string): string | null {
  const c = byCode.get(section)?.children.find((one) => one.code === child)
  return c ? BASE + c.path : null
}

/** Адрес без приставки — для роутера, который подставит её сам. Пока адрес
 *  уходил к нему как есть, /reference/prints превращался в
 *  /reference/reference/prints, маршрута нет — и меню выглядит мёртвым. */
export function routerPath(href: string): string {
  return href.startsWith(BASE + '/') ? href.slice(BASE.length) : href === BASE ? '/' : href
}

/** Какой раздел и подпункт подсвечены — по адресу без приставки. */
export function activeMenu(pathname: string): { section: string | null; child: string | null } {
  for (const s of SECTIONS) {
    const child = s.children.find((c) => pathname === c.path || pathname.startsWith(c.path + '/'))
    if (child) return { section: s.code, child: child.code }
    if (pathname === s.path || pathname.startsWith(s.path + '/')) return { section: s.code, child: null }
  }
  return { section: null, child: null }
}

/** Раздел, к которому относится адрес, — чтобы адрес раздела без права
 *  отвечал «нет такого пути», а не открывал страницу. */
export function sectionOfPath(pathname: string): string | null {
  return activeMenu(pathname).section
}
