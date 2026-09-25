// Рабочее окно поверх страницы во весь экран (US-0492).
//
// Кандидат в набор платформы (решение 0005): Modal из @platform/ui бывает
// обычным и широким, а работе с изделием нужен весь экран — холст, панель
// настроек и служебная полоса не помещаются в окно диалога. Как у Modal: фокус
// входит внутрь при открытии и возвращается туда, откуда открыли; страница под
// окном не прокручивается. Закрытие — забота экрана: у него «несохранено?» и
// адрес, а у рамки — только кнопка и Esc, переданные наверх.

import { useEffect, useRef, type ReactNode } from 'react'

export function WorkFrame({
  label,
  bar,
  children,
}: {
  /** Имя окна для чтения с экрана. */
  label: string
  /** Тонкая полоса сверху: имя, сохранение, закрыть. */
  bar: ReactNode
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    // Страница под окном не едет: колесо и клавиши принадлежат окну.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    root.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col bg-background text-foreground outline-none"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">{bar}</div>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  )
}
