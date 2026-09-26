// Плавная перестановка элементов сетки (US-0601): когда порядок меняется,
// элементы не прыгают, а доезжают до нового места — видно, куда что ушло.
// Приём FLIP: запомнить прежнее место, отрисовать новое, сыграть разницу.
//
// Кандидат в набор платформы (решение 0005): перестановки с анимацией в
// @platform/ui нет. Меряется по offsetLeft/offsetTop, а не по экрану: прокрутка
// сетки между перерисовками не должна выглядеть переездом.

import { useLayoutEffect, useRef, type RefObject } from 'react'

export function useFlip(container: RefObject<HTMLElement | null>, orderKey: string, durationMs = 180): void {
  const last = useRef(new Map<string, { x: number; y: number }>())
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const next = new Map<string, { x: number; y: number }>()
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const key = el.dataset.flip!
      const now = { x: el.offsetLeft, y: el.offsetTop }
      next.set(key, now)
      const was = last.current.get(key)
      if (was && (was.x !== now.x || was.y !== now.y)) {
        el.animate(
          [{ transform: `translate(${was.x - now.x}px, ${was.y - now.y}px)` }, { transform: 'none' }],
          { duration: durationMs, easing: 'ease-out' },
        )
      }
    })
    last.current = next
  }, [container, orderKey, durationMs])
}
