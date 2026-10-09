// Всплывающее семейство на витрине (US-0891): цвета модели×дропа крупными
// плашками; отсюда — в конкретный цвет окна. Одна карточка на витрине, не
// по карточке на каждый цвет (решение 0019).

import { buttonClass } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { fetchPalette, toCss } from '../shared/api/colours'
import { fetchFamily, type FamilyColour } from '../shared/api/references'

export function FamilyPopup({
  referenceId,
  name,
  onPick,
  onClose,
}: {
  referenceId: number
  name: string
  onPick: (colourCode: string) => void
  onClose: () => void
}) {
  const family = useQuery({
    queryKey: ['family', referenceId],
    queryFn: () => fetchFamily(referenceId),
  })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette })
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    root.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const byCode = new Map((palette.data?.colors ?? []).map((c) => [c.code, c]))
  const members = (family.data ?? []).filter((c) => c.in_family)

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label={`Семейство «${name}»`}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="pf-card max-h-[90vh] w-full max-w-xl overflow-auto border border-line p-4">
        <div className="mb-3 flex items-center gap-2">
          <strong className="text-base">Семейство · {name}</strong>
          <span className="flex-1" />
          <button
            className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })}
            onClick={onClose}
            aria-label="закрыть семейство"
          >
            ×
          </button>
        </div>
        {family.isPending && <p className="text-sm text-muted-foreground">Загружаю цвета…</p>}
        {family.isError && <p className="text-sm text-destructive">Цвета семьи не пришли — закройте и откройте снова.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {members.map((c) => {
            const swatch = byCode.get(c.colour_code)
            return (
              <ColourTile
                key={c.colour_model_id}
                colour={c}
                css={swatch ? toCss(swatch) : '#ccc'}
                onPick={onPick}
              />
            )
          })}
        </div>
        {family.isSuccess && members.length === 0 && (
          <p className="text-sm text-muted-foreground">В семье нет цветов — верните их из сравнения цветов в окне.</p>
        )}
      </div>
    </div>
  )
}

function ColourTile({
  colour,
  css,
  onPick,
}: {
  colour: FamilyColour
  css: string
  onPick: (code: string) => void
}) {
  return (
    <button
      type="button"
      className="flex flex-col gap-2 rounded border border-line p-2 text-left hover:border-accent"
      onClick={() => onPick(colour.colour_code)}
      title={`Открыть в цвете ${colour.colour_code}`}
    >
      <span className="block h-16 w-full rounded border border-line" style={{ background: css }} aria-hidden />
      <span className="text-sm font-medium">{colour.colour_code}</span>
    </button>
  )
}
