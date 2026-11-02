import { useLayoutEffect, useState, type RefObject } from 'react'

/** Геометрия сетки сохраняет всю прокрутку, DOM содержит только соседние ряды. */
export function useTileWindow(root: RefObject<HTMLElement | null>, count: number, rowHeight: number, minWidth: number, gap: number) {
  const [view, setView] = useState({ width: 1, top: 0, bottom: window.innerHeight })
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let frame = 0
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setView((was) => {
        const next = { width: el.clientWidth, top: Math.max(0, -rect.top), bottom: Math.max(0, window.innerHeight - rect.top) }
        return was.width === next.width && was.top === next.top && was.bottom === next.bottom ? was : next
      })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [root, count])
  const columns = Math.max(1, Math.floor((view.width + gap) / (minWidth + gap)))
  const rows = Math.ceil((count + 1) / columns)
  const stride = rowHeight + gap
  const firstRow = Math.max(0, Math.min(rows - 1, Math.floor(view.top / stride) - 1))
  const lastRow = Math.min(rows - 1, Math.ceil(view.bottom / stride) + 1)
  return {
    columns, rows,
    first: Math.max(0, firstRow * columns - 1),
    end: Math.min(count, (lastRow + 1) * columns - 1),
    position: (index: number) => ({ row: Math.floor(index / columns) + 1, column: index % columns + 1 }),
    reveal: (index: number) => {
      const el = root.current
      if (!el) return
      const top = el.getBoundingClientRect().top + Math.floor(index / columns) * stride
      let parent = el.parentElement
      while (parent && !['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) parent = parent.parentElement
      const host = parent ?? window
      const upper = parent?.getBoundingClientRect().top ?? 0
      const lower = parent?.getBoundingClientRect().bottom ?? window.innerHeight
      if (top < upper) host.scrollBy(0, top - upper)
      else if (top + rowHeight > lower) host.scrollBy(0, top + rowHeight - lower)
    },
  }
}
