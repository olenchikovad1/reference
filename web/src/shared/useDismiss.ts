// Всплывающее закрывается само (владелец 29.09: «я не должен нажимать
// крестики постоянно»): нажатие мимо него — по кофте, по полосе, где угодно —
// и Esc. Нажатие по тому, что его открывает, не считается «мимо»: иначе
// нажатие-закрытие тут же открывало бы его снова.

import { type RefObject, useEffect } from 'react'

export function useDismiss(open: boolean, close: () => void, inside: RefObject<HTMLElement | null>[], toggle?: string): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t) return
      if (inside.some((r) => r.current?.contains(t))) return
      if (toggle && t.closest(toggle)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
    // Список ref-ов стабилен по смыслу: сравниваются ref-объекты, а не их содержимое.
  }, [open, close])
}
