// Всплывающее семейство на витрине (US-0891): цвета модели×дропа крупными
// плашками; отсюда — в конкретный цвет окна. Одна карточка на витрине, не
// по карточке на каждый цвет (решение 0019).

import { buttonClass, Spinner } from '@platform/ui'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { fetchPalette, toCss } from '../shared/api/colours'
import { fetchFamily, fetchPlmFamily, setPlmFamilyColour, openReference, type FamilyColour } from '../shared/api/references'
import { savedPlmColorway } from '../shared/api/plm'
import { PlmPassport } from './PlmPassport'
import { useCan } from '../shared/api/platform'

export function FamilyPopup({
  referenceId,
  name,
  onPick,
  onClose,
  onOpen,
}: {
  referenceId: number
  name: string
  onPick: (colourCode: string, colorwayId?: string) => void
  onClose: () => void
  onOpen: () => void
}) {
  const family = useQuery({
    queryKey: ['family', referenceId],
    queryFn: () => fetchFamily(referenceId),
  })
  const palette = useQuery({ queryKey: ['palette'], queryFn: fetchPalette })
  const external = useQuery({ queryKey: ['plm-family', referenceId], queryFn: () => fetchPlmFamily(referenceId), retry: 1 })
  const canWrite = useCan('reference', 'references', 'write')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [passportOpen, setPassportOpen] = useState(false)
  const saved = useQuery({ queryKey: ['reference-passport', referenceId], queryFn: () => openReference(referenceId), enabled: passportOpen, retry: 1 })
  const colorway = savedPlmColorway(saved.data?.work)
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
  async function changeColour(id: string, included: boolean) {
    setBusy(true); setFailure(null)
    try {
      await setPlmFamilyColour(referenceId, id, included)
      await external.refetch()
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Цвет не изменён. Повторите.') }
    finally { setBusy(false) }
  }

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
        {external.isPending && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем цвета семьи</div>}
        {external.isError && <div role="alert" className="text-sm text-destructive">{external.error.message}{' '}
          <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => void external.refetch()}>повторить цвета</button></div>}
        {external.data && <>
          <p className="mb-2 text-xs text-muted-foreground">{external.data.style_code} · {external.data.drop_code} · одна работа на все включённые цвета</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-family-colour]:not(:disabled)'))
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (i < 0 || !buttons.length) return
            e.preventDefault(); buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus()
          }}>
            {external.data.colours.map(c => <div key={c.colorway_id} className={`rounded border border-line p-2 ${c.in_family ? '' : 'opacity-60'}`}>
              <button data-family-colour type="button" className="flex w-full flex-col gap-2 text-left text-sm"
                disabled={!c.in_family} onClick={() => onPick(c.colour_code, c.colorway_id)} title={`Открыть работу в цвете ${c.name}`}>
                <span className="block h-16 w-full rounded border border-line" style={{ background: c.rgb ? `rgb(${c.rgb.join(',')})` : undefined }} />
                <span>{c.name}</span><span className="text-xs text-muted-foreground">{c.pantone_code ?? 'код пантона PLM не передал'}{c.primary ? ' · основной' : ''} · {c.article}</span>
              </button>
              {!c.primary && canWrite && <button disabled={busy} className={`${buttonClass({ tone: 'neutral', variant: 'outline', small: true })} mt-2`}
                onClick={() => void changeColour(c.colorway_id, !c.in_family)}>{c.in_family ? 'исключить цвет' : 'вернуть цвет'}</button>}
            </div>)}
          </div>
          {failure && <p role="alert" className="mt-2 text-sm text-destructive">{failure}</p>}
        </>}
        {!external.data && family.isPending && <div role="status" className="flex items-center gap-2 text-sm"><Spinner />Получаем сохранённые цвета</div>}
        {!external.data && family.isError && <p className="text-sm text-destructive">Цвета семьи не пришли — откройте сохранённую работу ниже.</p>}
        {!external.data && <>
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
          <p className="text-sm text-muted-foreground">В семье пока нет цветов. Сохранённая работа доступна ниже.</p>
        )}
        </>}
        <button className={`${buttonClass({ tone: 'neutral', variant: 'outline', small: true })} mt-3`} onClick={onOpen}>
          открыть сохранённую работу
        </button>
        <button className={`${buttonClass({ tone: 'neutral', variant: 'outline', small: true })} mt-3 ml-2`} onClick={() => setPassportOpen(v => !v)} aria-expanded={passportOpen}>паспорт PLM</button>
        {passportOpen && (saved.isPending ? <div role="status" className="mt-2 flex items-center gap-2 text-sm"><Spinner />Получаем связь с моделью PLM</div>
          : saved.isError ? <p role="alert" className="mt-2 text-sm">{saved.error.message}</p>
          : colorway ? <PlmPassport colorwayId={colorway} />
          : <p className="mt-2 text-sm text-muted-foreground">В сохранённой версии нет связи с цветомоделью PLM.</p>)}
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
