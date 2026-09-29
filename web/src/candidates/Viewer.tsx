// Просмотр крупно (US-0715): принт или надпись во всё окно, соседние —
// стрелками, Esc — закрыть. Та же рамка, что у рабочего окна референса
// (WorkFrame): правее меню платформы, щелчок мимо — закрыть. Кандидат в
// платформу (решение 0005).

import { IconButton } from '@platform/ui'
import { useEffect, useRef, type ReactNode } from 'react'

import { WorkFrame } from './WorkFrame'

export function Viewer({
  label,
  title,
  at,
  total,
  onMove,
  onClose,
  tools,
  children,
}: {
  label: string
  title: ReactNode
  /** Номер открытого в списке, с нуля. */
  at: number
  total: number
  onMove: (to: number) => void
  onClose: () => void
  /** Что стоит в полосе справа от имени: голоса. */
  tools?: ReactNode
  children: ReactNode
}) {
  const latest = useRef({ at, total, onMove, onClose })
  latest.current = { at, total, onMove, onClose }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const { at, total, onMove, onClose } = latest.current
      const k = e.key.toLowerCase()
      if (e.key === 'Escape') onClose()
      else if ((e.key === 'ArrowLeft' || k === 'a' || k === 'ф') && at > 0) onMove(at - 1)
      else if ((e.key === 'ArrowRight' || k === 'd' || k === 'в') && at < total - 1) onMove(at + 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <WorkFrame
      label={label}
      onBackdrop={onClose}
      bar={
        <>
          <IconButton icon="arrow-left" aria-label="предыдущая" title="Предыдущая — ← или A" disabled={at === 0} onClick={() => onMove(at - 1)} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {at + 1} из {total}
          </span>
          <IconButton icon="arrow-right" aria-label="следующая" title="Следующая — → или D" disabled={at >= total - 1} onClick={() => onMove(at + 1)} />
          <div className="min-w-0 flex-1 truncate font-semibold">{title}</div>
          {tools}
          <IconButton icon="x" aria-label="закрыть" title="Закрыть — Esc" onClick={onClose} />
        </>
      }
    >
      {children}
    </WorkFrame>
  )
}
