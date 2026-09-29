// Карточка референса — одна на витрину и на согласование (US-0688): тот же
// вид с миниатюрами сторон, по которому референс узнают глазом, а не строка
// с номером. Кандидат в платформу только раскладкой (решение 0005).

import { buttonClass } from '@platform/ui'
import { memo, type PointerEvent as ReactPointerEvent, useState } from 'react'

import { meaningClass } from './meaning'
import { assetUrl } from '../shared/api/assets'
import { STATUS_NAMES, type Card } from '../shared/api/references'

/** Карточка: перед в левом нижнем углу, спина в правом верхнем, внахлёст.
 *  Нажатие открывает окно; «копия» и «удалить» — отдельными кнопками в углу,
 *  а не меню: делают их часто и без открытия. */
/**
 * Карточка витрины перерисовывается, только когда поменялась она сама
 * (правка владельца 26.09): витрина показывает сохранённое, и сохранение
 * одной карточки не должно перерисовывать остальные. Список после сохранения
 * перечитывается, но неизменённые карточки приходят теми же объектами —
 * сравнение по ссылке их пропускает. Обработчики не сравниваются: они берут
 * актуальное через ref и функциональные обновления.
 */
export const ReferenceCard = memo(
  ReferenceCardView,
  (a, b) =>
    a.card === b.card &&
    a.selected === b.selected &&
    a.dragging === b.dragging &&
    !a.onGrip === !b.onGrip &&
    a.reasons === b.reasons &&
    !a.onCopy === !b.onCopy &&
    !a.onTrash === !b.onTrash &&
    !a.onErase === !b.onErase &&
    !a.onDiscard === !b.onDiscard &&
    a.note === b.note,
  // Обработчики не сравниваются: они зовут свежие функции через ref (live).
)

function ReferenceCardView({
  card,
  onOpen,
  onHover,
  dragging,
  onGrip,
  onPress,
  onMoveTo,
  onCopy,
  onTrash,
  onErase,
  reasons,
  selected,
  note,
  onDiscard,
}: {
  card: Card
  /** Выделена для действия над несколькими (US-0501). */
  selected?: boolean
  /** Почему найдена — при поиске (US-0498). */
  reasons?: string[]
  onOpen: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  /** Мышь над карточкой — карточку готовят заранее (US-0600). */
  onHover?: () => void
  /** Её сейчас переносят: на её месте — пустое место с чертой (US-0601). */
  dragging?: boolean
  /** Взяли за ручку ⠿ — перенос сразу. */
  onGrip?: (e: ReactPointerEvent) => void
  /** Нажали на карточку — долгое нажатие станет переносом. */
  onPress?: (e: ReactPointerEvent) => void
  /** Меню «переместить». */
  onMoveTo?: (to: 'start' | 'end' | number) => void
  onCopy?: () => void
  onTrash?: () => void
  onErase?: () => void
  /** Почему карточка здесь (US-0688): «вернули с 2 замечаниями», что
   *  поменялось в черновике. Строки — под именем, внутри карточки. */
  note?: { text: string; tone?: 'warning' | 'muted' }[]
  /** «Выбросить черновик» — в углу, как «удалить». */
  onDiscard?: () => void
}) {
  const front = card.views.front
  const back = card.views.back
  const corner = buttonClass({ tone: 'neutral', variant: 'outline', small: true })
  const [menu, setMenu] = useState(false)
  const [before, setBefore] = useState('')
  return (
    <div data-flip={card.id} className={`group relative flex min-h-0 flex-col ${dragging ? 'opacity-40' : ''}`}>
      {/* Куда встанет — видно заранее: черта над местом переносимой. */}
      {dragging && <div aria-hidden className="absolute -top-2 left-0 right-0 z-10 h-1 rounded bg-primary" />}
    <button
      data-card
      data-card-id={card.id}
      aria-pressed={selected}
      onClick={(e) => onOpen(e)}
      onPointerDown={onPress}
      onPointerEnter={onHover}
      onFocus={onHover}
      className={`pf-card flex min-h-0 flex-1 flex-col overflow-hidden border text-left ${selected ? 'border-primary ring-2 ring-primary' : 'border-line'}`}
      title={`${card.name} · версия ${card.number}`}
    >
      <div className="relative min-h-0 flex-1">
        {back && (
          <img src={assetUrl(back, 'thumb')} alt="спина" className="absolute right-0 top-0 h-[64%] w-[64%] object-contain" />
        )}
        {front && (
          <img src={assetUrl(front, 'thumb')} alt="перед" className="absolute bottom-0 left-0 h-[64%] w-[64%] object-contain" />
        )}
        {!front && !back && (
          <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted-foreground">
            снимка нет — сохранён до витрины
          </span>
        )}
      </div>
      <div className="px-2 py-1 text-xs">
        <div className="truncate font-semibold">
          №{card.id} · {card.name}
        </div>
        <div className="truncate text-muted-foreground">
          {card.drops[0] ?? 'без дропа'} · {new Date(card.saved_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          {card.forked_from_id && ` · от №${card.forked_from_id}`}
        </div>
        {card.status && card.status !== 'draft' && (
          <div className="truncate text-xs font-semibold">{STATUS_NAMES[card.status]}</div>
        )}
        {card.executor && (
          <div className={`truncate ${card.executor.access ? 'text-muted-foreground' : 'text-warning'}`}>
            {card.executor.name}
            {!card.executor.access && ' · нет доступа'}
          </div>
        )}
        {/* Несохранённое поверх версий (US-0598): своё — «черновик», чужое —
            чьё, чтобы не удивляться, что у коллеги на экране другое. */}
        {(card.my_draft || (card.others_drafts?.length ?? 0) > 0) && (
          <div
            className="truncate text-warning"
            title="Правки поверх последней версии, ещё не ставшие версией. На витрине — последняя версия."
          >
            {[card.my_draft && 'мой черновик', card.others_drafts?.length && `несохранённое у: ${card.others_drafts.join(', ')}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
        {note?.map((n) => (
          <div key={n.text} className={`line-clamp-2 ${n.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}`} title={n.text}>
            {n.text}
          </div>
        ))}
        {reasons?.slice(0, 2).map((r) => (
          <div key={r} className="truncate text-primary" title={r}>
            {r}
          </div>
        ))}
      </div>
    </button>
      {onGrip && (
        <button
          className={`${corner} absolute right-1 top-1 cursor-grab opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100`}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.preventDefault()
            onGrip(e)
          }}
          onClick={() => {
            // Щелчок после переноса мышью — не просьба о меню.
            if (!dragging) setMenu((m) => !m)
          }}
          title="Тяните, чтобы переставить; щелчок — меню «переместить»"
          aria-label={`переместить №${card.id}`}
          aria-expanded={menu}
        >
          ⠿
        </button>
      )}
      {menu && onMoveTo && (
        <div className="pf-card absolute right-1 top-9 z-20 flex w-40 flex-col gap-1 border border-line bg-background p-2 text-xs shadow">
          <button className={corner} onClick={() => (onMoveTo('start'), setMenu(false))}>
            в начало
          </button>
          <button className={corner} onClick={() => (onMoveTo('end'), setMenu(false))}>
            в конец
          </button>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (Number(before)) onMoveTo(Number(before))
              setMenu(false)
            }}
          >
            <input
              className="w-16 rounded border border-line px-1"
              inputMode="numeric"
              placeholder="перед №"
              aria-label="поставить перед карточкой номер"
              value={before}
              onChange={(e) => setBefore(e.target.value)}
            />
            <button className={corner} type="submit">
              ок
            </button>
          </form>
        </div>
      )}
      {(onCopy || onTrash || onErase || onDiscard) && (
        <div className="absolute left-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onCopy && (
            <button className={corner} onClick={onCopy} title="Копия последней версии — рядом, с отметкой «от №…»">
              копия
            </button>
          )}
          {onTrash && (
            <button className={meaningClass('withdraw', true)} onClick={onTrash} title="В корзину: 30 дней можно вернуть">
              удалить
            </button>
          )}
          {onDiscard && (
            <button className={meaningClass('withdraw', true)} onClick={onDiscard} title="Выбросить черновик: работа снова как в версии, версия не меняется">
              выбросить
            </button>
          )}
          {onErase && (
            <button className={meaningClass('destroy', true)} onClick={onErase} title="Зашквар: насовсем сразу, мимо корзины, с причиной">
              насовсем
            </button>
          )}
        </div>
      )}
    </div>
  )
}
