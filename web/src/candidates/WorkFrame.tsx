// Рабочее окно — всплывающее поверх страницы (US-0492, правка владельца
// 25.09: «нужно именно всплывающее окно», а не смена всей страницы).
//
// Кандидат в набор платформы (решение 0005): Modal из @platform/ui бывает
// обычным и широким, а работе с изделием нужно почти всё окно браузера —
// холст, панель настроек и служебная полоса в диалог не помещаются. Страница
// под ним остаётся видна по краям и затемнена; щелчок по ней — закрыть. Как у Modal: фокус
// входит внутрь при открытии и возвращается туда, откуда открыли; страница под
// окном не прокручивается. Закрытие — забота экрана: у него «несохранено?» и
// адрес, а у рамки — только кнопка и Esc, переданные наверх.

import { useEffect, useRef, type ReactNode } from 'react'

export function WorkFrame({
  label,
  bar,
  children,
  onBackdrop,
}: {
  /** Имя окна для чтения с экрана. */
  label: string
  /** Тонкая полоса сверху: имя, сохранение, закрыть. */
  bar: ReactNode
  children: ReactNode
  /** Щелчок мимо окна — по затемнённой странице. */
  onBackdrop?: () => void
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onBackdrop?.()
      }}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="flex h-[94vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-xl bg-background text-foreground shadow-2xl outline-none"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">{bar}</div>
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
