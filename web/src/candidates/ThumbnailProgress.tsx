import { Progress, Spinner } from '@platform/ui'
import { useEffect, useState, type RefObject } from 'react'

/** Считаем завершившиеся изображения видимого экрана, а не мнимые проценты сети. */
export function ThumbnailProgress({ root, pending }: { root: RefObject<HTMLElement | null>; pending: boolean }) {
  const [state, setState] = useState({ total: 0, loaded: 0, failed: 0 })
  useEffect(() => {
    const el = root.current
    if (!el) return
    let frame = 0
    const measure = () => {
      const images = [...el.querySelectorAll<HTMLImageElement>('[data-card-id] img')].filter(img => {
        const rect = img.getBoundingClientRect()
        return rect.top < window.innerHeight && rect.bottom > 0
      })
      const next = { total: images.length, loaded: images.filter(img => img.complete && img.naturalWidth > 0).length,
        failed: images.filter(img => img.complete && img.naturalWidth === 0).length }
      setState(was => was.total === next.total && was.loaded === next.loaded && was.failed === next.failed ? was : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new MutationObserver(schedule)
    observer.observe(el, { childList: true, subtree: true })
    el.addEventListener('load', schedule, true)
    el.addEventListener('error', schedule, true)
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      el.removeEventListener('load', schedule, true)
      el.removeEventListener('error', schedule, true)
      document.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [root, pending])
  const waiting = state.loaded + state.failed < state.total
  return (
    <div className="mb-2 min-h-10 text-sm text-muted-foreground" aria-live="polite">
      {pending ? <span role="status" className="flex items-center gap-2"><Spinner />Получаем список референсов…</span>
        : waiting ? <div className="flex items-center gap-2"><Spinner /><div className="flex-1">
          <Progress part={(state.loaded + state.failed) / state.total} label="Миниатюры на экране" note={`${state.loaded} из ${state.total}`} />
        </div></div>
        : state.failed > 0 ? <span role="status">Не загрузилось снимков: {state.failed}. Обновите страницу, чтобы повторить.</span>
        : null}
    </div>
  )
}
