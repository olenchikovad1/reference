import { Spinner } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { fetchPlmPassport, plmImageUrl, selectPlmImage } from '../shared/api/plm'

/** Паспорт только видимой плитки: тысячи ЦМ не превращаются в тысячи запросов. */
export function PlmModelImage({ id, image, label }: { id: string; image: string | null; label: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const passport = useQuery({ queryKey: ['plm-passport', id], queryFn: () => fetchPlmPassport(id),
    enabled: visible, staleTime: 30_000, retry: false })
  const key = passport.data ? (passport.data.images?.length ? selectPlmImage(passport.data.images) : image)
    : passport.isError ? image : null
  const src = plmImageUrl(key)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    })
    if (box.current) observer.observe(box.current)
    return () => observer.disconnect()
  }, [id])
  useEffect(() => { setLoaded(false); setFailed(false) }, [src])
  const pending = visible && (passport.isPending || (Boolean(src) && !loaded && !failed))
  return <span ref={box} className="relative mb-1 flex h-20 w-full items-center justify-center rounded-sm bg-muted" aria-busy={pending}>
    {visible && src && !failed && <img src={src} alt={label} loading="lazy" decoding="async"
      className="h-full w-full object-contain" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    {pending && <span role="status" className="absolute inset-0 flex items-center justify-center gap-1 text-xs"><Spinner />Изображение PLM</span>}
    {visible && (failed || passport.isError) && <span className="text-xs text-destructive">Изображение не пришло</span>}
    {visible && !pending && !src && !passport.isError && <span className="text-xs text-muted-foreground">PLM не передал изображение</span>}
  </span>
}
