// Сетка карточек референсов вне витрины — «Согласование», «Повестка» (US-0688,
// US-0711): та же карточка, по которой референс узнают глазом, ровными
// ячейками. Кандидат в платформу только раскладкой (решение 0005).

import type { ReactNode } from 'react'

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {children}
    </div>
  )
}
