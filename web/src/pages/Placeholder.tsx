// Ещё не сделанная страница — заглушка со смыслом: что здесь будет и в каком
// плане, а не пустота и не «в разработке» (план 072, US-0485).

import type { SectionPlace } from '../app/sections'

export function Placeholder({ section, name }: { section: SectionPlace; name: string }) {
  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{name}</h1>
      <p style={{ margin: '0 0 8px', lineHeight: 1.5 }}>{section.about}</p>
      <p style={{ margin: 0, color: '#666', fontSize: 13 }}>
        Страница будет сделана: {section.plan}. Пока примерка принта — на первой странице приложения.
      </p>
    </main>
  )
}

/** Адрес, которого нет, — и адрес раздела, на который нет права: отвечают
 *  одинаково, чтобы по ответу нельзя было узнать, что закрыто. */
export function NotFound() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Нет такого пути</h1>
      <p style={{ margin: 0, color: '#666' }}>Проверьте адрес или выберите раздел в меню слева.</p>
    </main>
  )
}
