// Значок «?» с горячими клавишами страницы (US-0631): на каждой странице, где
// клавиши есть, — на самой странице, не во всплывающей форме. Одна подсказка
// на все страницы: страница отдаёт свою таблицу, вид одинаковый.
//
// Кандидат в набор платформы (решение 0005): Popover в @platform/ui есть,
// подсказки клавиш поверх него — нет.

import { Popover, buttonClass } from '@platform/ui'
import { useEffect, useRef, useState } from 'react'

import type { KeyRow } from '../shared/keys'

export function HotkeysHint({
  rows,
  label,
  open: openFromPage,
  onOpenChange,
  listen = true,
}: {
  rows: readonly KeyRow[]
  /** Чьи клавиши: «Клавиши витрины». */
  label: string
  /** Управляется страницей — когда клавишу «?» разбирает она сама (окно). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Слушать клавишу «?» самой. Страница, у которой она уже в разборе
   *  клавиш, выключает — иначе «?» открывал бы и закрывал одновременно. */
  listen?: boolean
}) {
  const [own, setOwn] = useState(false)
  const open = openFromPage ?? own
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOwn(v))
  const anchor = useRef<HTMLButtonElement | null>(null)
  const latest = useRef({ open, setOpen })
  latest.current = { open, setOpen }

  useEffect(() => {
    if (!listen) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key !== '?') return
      e.preventDefault()
      latest.current.setOpen(!latest.current.open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listen])

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${label} — подсказка`}
        title={`${label} — «?»`}
      >
        ?
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label={label} side="bottom">
        <div className="max-w-md p-3">
          <p className="mb-2 text-sm font-semibold">{label}</p>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.keys}>
                  <td className="whitespace-nowrap py-0.5 pr-4 align-top font-mono text-xs">{r.keys}</td>
                  <td className="py-0.5">{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Клавиши работают в любой раскладке; в полях ввода буквы и цифры печатаются. Esc — закрыть.
          </p>
        </div>
      </Popover>
    </>
  )
}
