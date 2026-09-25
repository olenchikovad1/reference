// Экраны «Референса» в рамке платформы (план 072, US-0485).
//
// Первая страница — нынешний экран примерки принта: он остаётся, пока его не
// заменит рабочее окно (план 073). Остальные разделы — заглушки со смыслом.
// Адрес раздела, на который у человека нет права, отвечает «нет такого
// пути», как и несуществующий: по ответу не узнать, что закрыто.

import { readAppearance, type Appearance } from '@platform/shell'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactElement, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { Bench } from '../pages/Bench'
import { Drops } from '../pages/Drops'
import { Products } from '../pages/Products'
import { NotFound, Placeholder } from '../pages/Placeholder'
import { useProfile, useSections, WITHOUT_PLATFORM } from '../shared/api/platform'
import { BASE, SECTIONS, type SectionPlace } from './sections'
import { CODE, Shell } from './shell'

const queries = new QueryClient()

/** Где открывать «Референс» по-настоящему — для экрана «откройте через платформу». */
const PLATFORM_URL = import.meta.env.VITE_PLATFORM_URL ?? 'http://localhost:8100'

/** Сделанные страницы разделов; остальные — заглушки со смыслом. */
const PAGES: Record<string, () => ReactElement> = {
  drops: () => <Drops />,
  products: () => <Products />,
}

function Guarded({ section }: { section: SectionPlace }) {
  const own = useSections(CODE)
  const page = PAGES[section.code]
  if (WITHOUT_PLATFORM) return page ? page() : <Placeholder section={section} name={section.title} />
  if (own.isPending) return null
  const allowed = own.data?.find((s) => s.code === section.code)
  if (!allowed) return <NotFound />
  return page ? page() : <Placeholder section={section} name={allowed.name} />
}

function Pages() {
  return (
    <Routes>
      <Route path="/" element={<Bench />} />
      {SECTIONS.flatMap((s) => [
        <Route key={s.code} path={s.path} element={<Guarded section={s} />} />,
        ...s.children.map((c) => <Route key={`${s.code}/${c.code}`} path={c.path} element={<Guarded section={s} />} />),
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

export function App() {
  return (
    <QueryClientProvider client={queries}>
      {/* Приставка — основание всех адресов: шлюз путь не срезает. */}
      <BrowserRouter basename={BASE}>
        {WITHOUT_PLATFORM ? (
          <>
            <div role="status" style={{ background: '#fef3c7', color: '#92400e', padding: '6px 12px', fontSize: 13 }}>
              Работает без платформы: входа и прав нет, меню не показывается. Настройка VITE_WITHOUT_PLATFORM в web/.env.
            </div>
            <Pages />
          </>
        ) : (
          <Framed>
            <Pages />
          </Framed>
        )}
      </BrowserRouter>
    </QueryClientProvider>
  )
}
