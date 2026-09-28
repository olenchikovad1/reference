// Экраны «Референса» в рамке платформы (план 072, US-0485).
//
// Первая страница — нынешний экран примерки принта: он остаётся, пока его не
// заменит рабочее окно (план 073). Остальные разделы — заглушки со смыслом.
// Адрес раздела, на который у человека нет права, отвечает «нет такого
// пути», как и несуществующий: по ответу не узнать, что закрыто.

import { readAppearance, type Appearance } from '@platform/shell'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useState, type ReactElement, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes } from 'react-router-dom'

import { WorkWindow } from '../pages/WorkWindow'
import { Drops } from '../pages/Drops'
import { Products } from '../pages/Products'
import { Prints } from '../pages/Prints'
import { Texts } from '../pages/Texts'
import { Showcase } from '../pages/Showcase'
import { Trash } from '../pages/Trash'
import { NotFound, Placeholder } from '../pages/Placeholder'
import { Dictionaries } from '../pages/Dictionaries'
import { fetchPeople, installStandAs, ROLE_NAMES, setStandAs, standAs } from '../shared/api/people'
import { useProfile, useSections, WITHOUT_PLATFORM } from '../shared/api/platform'
import { BASE, SECTIONS, type SectionPlace } from './sections'
import { CODE, Shell } from './shell'

const queries = new QueryClient()

// Стенд без платформы: «я — …» уходит заголовком с каждым запросом (план 075).
if (WITHOUT_PLATFORM) installStandAs()

/** Где открывать «Референс» по-настоящему — для экрана «откройте через платформу». */
const PLATFORM_URL = import.meta.env.VITE_PLATFORM_URL ?? 'http://localhost:8100'

/** Сделанные страницы разделов; остальные — заглушки со смыслом. */
const PAGES: Record<string, () => ReactElement> = {
  references: () => <Showcase />,
  prints: () => <Prints />,
  texts: () => <Texts />,
  'references/trash': () => <Trash />,
  drops: () => <Drops />,
  products: () => <Products />,
  dictionaries: () => <Dictionaries />,
}

/** Страница раздела, а поверх неё — окно (`overlay`), если оно открыто по
 *  адресу: рабочее окно референса лежит поверх витрины, и «назад» его
 *  закрывает. Право то же, что на раздел. */
function Guarded({ section, sub, overlay }: { section: SectionPlace; sub?: string; overlay?: ReactElement }) {
  const own = useSections(CODE)
  // Подпункт со своей страницей (корзина) — она; нет — страница раздела.
  const page = (sub && PAGES[`${section.code}/${sub}`]) || PAGES[section.code]
  const shown = (name: string) => (
    <>
      {page ? page() : <Placeholder section={section} name={name} />}
      {overlay}
    </>
  )
  if (WITHOUT_PLATFORM) return shown(section.title)
  if (own.isPending) return null
  const allowed = own.data?.find((s) => s.code === section.code)
  if (!allowed) return <NotFound />
  return shown(allowed.name)
}

function Pages() {
  return (
    <Routes>
      {/* Временный экран примерки убран: работа идёт в окне поверх витрины. */}
      <Route path="/" element={<Navigate to="/references" replace />} />
      {/* Витрина и окно — ОДИН маршрут с необязательным номером (US-0600):
          разные маршруты пересоздавали витрину при каждом открытии окна, а окно
          — при каждом закрытии. Теперь оба живут всё время, закрытое окно
          скрыто, и открыть карточку — значит показать её, а не собрать экран. */}
      <Route
        path="/references/:ref?"
        element={<Guarded section={SECTIONS.find((s) => s.code === 'references')!} overlay={<WorkWindow />} />}
      />
      {SECTIONS.flatMap((s) => [
        ...(s.code === 'references' ? [] : [<Route key={s.code} path={s.path} element={<Guarded section={s} />} />]),
        ...s.children.map((c) => (
          <Route key={`${s.code}/${c.code}`} path={c.path} element={<Guarded section={s} sub={c.code} />} />
        )),
      ])}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

/** Открыт в обход шлюза — по своему порту: ядра платформы здесь нет. Не
 *  работать молча анонимно, а сказать, где открыть. */
function OpenThroughPlatform() {
  const url = `${PLATFORM_URL}${BASE}/`
  return (
    <main style={{ padding: 32, maxWidth: 560 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Откройте «Референс» через платформу</h1>
      <p style={{ lineHeight: 1.5 }}>
        Вход, права и меню — у платформы. Здесь приложение открыто по своему порту, мимо неё.
      </p>
      <a href={url}>{url}</a>
    </main>
  )
}

function Framed({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance())
  const me = useProfile()
  if (me.isPending) return null
  if (me.isError) return <OpenThroughPlatform />
  return (
    <Shell appearance={appearance} onAppearance={setAppearance}>
      {children}
    </Shell>
  )
}

function Root() {
  return WITHOUT_PLATFORM ? (
    <>
      <div role="status" style={{ background: '#fef3c7', color: '#92400e', padding: '6px 12px', fontSize: 13 }}>
        Работает без платформы: входа и прав нет, меню не показывается. Настройка VITE_WITHOUT_PLATFORM в web/.env.{' '}
        <StandAs />
      </div>
      <Pages />
    </>
  ) : (
    <Framed>
      <Pages />
    </Framed>
  )
}

// Роутер с данными, а не BrowserRouter: только он умеет задержать уход со
// страницы (useBlocker) — примерка с несохранённым спрашивает «сохранить?»,
// а не теряет правки молча (US-0490). Приставка — основание всех адресов:
// шлюз путь не срезает.
const router = createBrowserRouter([{ path: '*', element: <Root /> }], { basename: BASE })

export function App() {
  return (
    <QueryClientProvider client={queries}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

/** «Я — …» стенда: от чьего имени работать. Входа без платформы нет, а
 *  согласование — работа двоих (план 075). */
function StandAs() {
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople }, queries)
  const [who, setWho] = useState(() => standAs() ?? '')
  return (
    <label>
      я —{' '}
      <select
        aria-label="от чьего имени работать на стенде"
        value={who}
        onChange={(e) => {
          setStandAs(e.target.value || null)
          setWho(e.target.value)
          void queries.invalidateQueries()
        }}
      >
        <option value="">стенд без входа</option>
        {people.data
          ?.filter((p) => p.role)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name} · {ROLE_NAMES[p.role!]}
            </option>
          ))}
      </select>
    </label>
  )
}
