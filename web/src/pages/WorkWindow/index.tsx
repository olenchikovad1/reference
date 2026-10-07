import { ElementPanel } from './ElementPanel'
import { GarmentPanel } from './GarmentPanel'
import { on, small } from './controls'
import { useWorkWindow } from './useWorkWindow'
import { PANEL_SPACE, SIDE_NAMES, THUMB_SCALE, noop } from './constants'
import { TextInput, buttonClass } from '@platform/ui'

import { GarmentCanvas } from '../../candidates/GarmentCanvas'
import { WorkFrame } from '../../candidates/WorkFrame'
import { frameUrl } from '../../shared/api/products'
import { heightCm, place, select } from '../../shared/composition'
import { formatCm } from '../../shared/geometry'
import type { Tag } from '../../shared/api/assets'
import { assetUrl, digestOf } from '../../shared/api/assets'
import { addTag, hideTag, removeTag, unhideTag } from '../../shared/api/references'
import { WINDOW_KEYS } from '../../shared/keys'
import { HotkeysHint } from '../../candidates/HotkeysHint'
import { weightText } from '../../shared/percent'
import { meaningClass } from '../../candidates/meaning'
import { WorkPicker } from '../WorkPicker'
import { ColourCompare } from '../ColourCompare'
import { resetAtSize, scaleAt, setScale } from '../../shared/grading'
import { cardKey } from '../../shared/cardCache'
import { historyRows } from '../../shared/versions'
import { blocking } from '../../shared/checks'
import { describe as describeSheet } from '../../shared/sheet'

import { Num, Section } from './controls'
import { fileRows, cardRows, Recognised, TagChips, NameChip } from './recognised'
import { S } from './styles'
import { ExecutorSection, ReviewSection, AgendaSection } from './people'
import { DecisionBar } from './decisions'
import { FREE_REMARK, RemarksSection } from './remarks'

// Рабочее окно референса (US-0492): открывается поверх витрины по адресу
// /references/<номер> (или /references/new), «назад» в браузере его закрывает.
//
// Раскладка по месту действия, а не колонкой настроек: сверху тонкая полоса
// (имя, «Сохранить», «Сохранить как», закрыть), справа служебная полоса (что
// на изделии с тегами, история, проверки, выгрузка), в правом верхнем углу
// холста — виды иконками, а настройки появляются там, где нажали: принт —
// размер, положение, поворот, градация; надпись — текст, шрифт, цвет;
// изделие — цвет, размер, показ. Колесо, протяжка и клавиши принадлежат окну.
//
// Холст, объём торса, проверки зон и градация — отдельными модулями и
// переехали как есть из временного экрана примерки; здесь раскладка и связка.

export function WorkWindow() {
  const w = useWorkWindow()
  const {
    ref,
    windowOpen,
    queries,
    product,
    error,
    stateCode,
    setStateCode,
    size,
    overlay,
    composition,
    setComposition,
    commit,
    dropHint,
    setDropHint,
    params,
    renderScale,
    setFps,
    prints,
    images,
    imagesVersion,
    restored,
    zoom,
    pan,
    press,
    box,
    area,
    stage,
    garmentPicked,
    helpOpen,
    setHelpOpen,
    refTags,
    tagDraft,
    setTagDraft,
    tagHints,
    libraryOpen,
    setLibraryOpen,
    compareOpen,
    setCompareOpen,
    seen,
    setSeen,
    seenCards,
    setSeenCards,
    canSave,
    tagsOf,
    current,
    setCurrent,
    remarks,
    placing,
    setPlacing,
    talkOpen,
    setTalkOpen,
    talkRef,
    pendingRemark,
    setPendingRemark,
    focusRemark,
    setFocusRemark,
    viewing,
    draftStatus,
    coldView,
    draftHeld,
    openAutos,
    setOpenAutos,
    saving,
    dismissed,
    setDismissed,
    viewCanvas,
    thumbCanvases,
    state,
    grid,
    hoodDownScale,
    calibration,
    sized,
    placeSized,
    visible,
    thumbWork,
    torso,
    anchorsBySide,
    elsewhere,
    fieldOutline,
    clips,
    selected,
    dirty,
    checked,
    keyOf,
    open,
    addFromSet,
    saveCard,
    saveCardAs,
    goTo,
    showDraft,
    discard,
    downloadSheet,
    downloadSnapshot,
    addLabel,
    pick,
    close,
    retag,
    openRemarks,
    refDropIds,
    catalogueDropName,
    board,
    isApproved,
    colourChoices,
    saveColours,
    onAreaDown,
    onAreaMove,
    onAreaUp,
    addFiles,
    onDrop,
  } = w

  const closeOnly = (
    <>
      <span className="flex-1" />
      <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={close} aria-label="закрыть окно">
        ×
      </button>
    </>
  )
  if (error)
    return (
      <WorkFrame label="рабочее окно" bar={closeOnly} open={windowOpen}>
        <p className="p-6">Изделие не загрузилось: {error}. Закройте окно и откройте референс ещё раз.</p>
      </WorkFrame>
    )
  if (!product || !state)
    return (
      <WorkFrame label="рабочее окно" bar={closeOnly} open={windowOpen}>
        <p className="p-6 text-muted-foreground">Загружаю изделие…</p>
      </WorkFrame>
    )

  const cal = product.calibration
  const hiddenCodes = new Set((refTags?.hidden ?? []).map((h) => h.code))
  const autoTags = [
    ...composition.elements
      .flatMap((el) => (el.kind === 'image' ? (tagsOf[digestOf(el.src)]?.tags ?? []) : []))
      .filter((tg) => tg.strong && !hiddenCodes.has(tg.code))
      .reduce((m, tg) => (m.get(tg.code)?.score ?? -1) < tg.score ? m.set(tg.code, tg) : m, new Map<string, Tag>())
      .values(),
  ].sort((a, b) => b.score - a.score)
  const title = current ? `№${current.id} · ${current.name}` : `${product.display_name} · новый референс`
  const panel: 'element' | 'garment' | null = selected ? 'element' : garmentPicked ? 'garment' : null

  // Окно уже видно, а в нём ещё прежняя карточка — на кадр-другой, пока новая
  // не легла. Закрываем холст снимком витрины, а без снимка — фоном: чужой
  // принт на миг хуже пустоты (US-0600).
  const stale = windowOpen && !!ref && ref !== 'new' && Number(ref) !== current?.id
  const cover = (() => {
    if (coldView) return coldView
    if (!stale) return null
    const listed = queries.getQueryData<{ id: number; views: Record<string, string> }[]>(['references'])?.find((c) => c.id === Number(ref))
    const view = listed?.views[stateCode] ?? listed?.views.front ?? listed?.views.back
    return view ? assetUrl(view, 'preview') : 'blank'
  })()

  const bar = (
    <>
      <h1 className="truncate text-sm font-semibold" title={title}>
        {title}
      </h1>
      <span className="truncate text-xs text-muted-foreground">
        {current ? `версия ${viewing} из ${current.versions.length}` : 'ещё не сохранён'}
        {current?.forked_from &&
          ` · пошёл от №${current.forked_from.reference_id}, версия ${current.forked_from.number}`}
        {restored && ' · открыт черновик'}
      </span>
      {(dirty || draftStatus === 'unsent') && (
        <span
          role="status"
          className={`shrink-0 text-xs ${draftStatus === 'unsent' ? 'text-destructive' : 'text-warning'}`}
          title="Правки пишутся в черновик сами и ждут вас здесь же, на любом компьютере. Версия — Ctrl+S."
        >
          {draftStatus === 'unsent'
            ? '● черновик не записан на сервер — нет связи, повторю сам'
            : `● черновик${draftStatus === 'written' ? ' записан' : ''} · не версия`}
        </span>
      )}
      <span className="flex-1" />
      {canSave && (
        <>
          <button className={small('accent')} disabled={saving} onClick={() => void saveCard()} title="Ctrl+S — новая версия">
            {saving ? 'сохраняю…' : 'Сохранить'}
          </button>
          <button
            className={small()}
            disabled={saving}
            onClick={() => void saveCardAs()}
            title="Ctrl+Shift+S — новый референс от того, что на экране"
          >
            Сохранить как
          </button>
        </>
      )}
      <button
        className={small()}
        onClick={() => setCompareOpen((v) => !v)}
        aria-pressed={compareOpen}
        title="Тот же принт на нескольких цветах рядом"
      >
        сравнить цвета
      </button>
      {/* Клавишу «?» разбирает само окно — подсказка её не слушает. */}
      <HotkeysHint rows={WINDOW_KEYS} label="Клавиши окна" open={helpOpen} onOpenChange={setHelpOpen} listen={false} />
      <button className={small()} onClick={close} title="Закрыть — Esc, когда ничего не выбрано" aria-label="закрыть окно">
        ×
      </button>
    </>
  )

  const placement = selected && (
    <Section title="Размещение">
      <Num
        label="от горловины вниз"
        value={selected.placement.dyCm}
        onChange={(v) => commit((c) => placeSized(c, selected.id, { dyCm: v }))}
      />
      <Num
        label="от центра вбок"
        value={selected.placement.dxCm}
        onChange={(v) => commit((c) => placeSized(c, selected.id, { dxCm: v }))}
      />
      <Num
        label="ширина"
        value={selected.placement.widthCm}
        onChange={(v) => commit((c) => placeSized(c, selected.id, { widthCm: Math.max(0.5, v) }))}
      />
      {size !== null && grid && size !== grid.base && (() => {
        const base = composition.elements.find((e) => e.id === selected.id)
        if (!base) return null
        const sc = scaleAt(base.placement, grid, size)
        return (
          <>
            {/* Коэффициент ТЕКУЩЕГО размера к базе. Вписанный — это
                исключение: на этом размере принт наносят не по сетке. */}
            <Num
              label={`коэффициент на ${size}`}
              value={sc.k}
              unit=""
              step={0.01}
              digits={3}
              onChange={(v) => commit((c) => place(c, base.id, setScale(base.placement, size, Math.max(0.05, v))))}
            />
            <p className={sc.manual ? 'text-xs text-warning' : 'text-xs text-muted-foreground'}>
              {sc.manual ? `вручную · по сетке ×${sc.byGrid.toFixed(3)} ` : `по сетке, база ${grid.base}`}
              {sc.manual && (
                <button
                  className="ml-1 text-muted-foreground"
                  title="вернуть к сетке"
                  onClick={() => commit((c) => place(c, base.id, resetAtSize(base.placement, size)))}
                >
                  ↺
                </button>
              )}
            </p>
          </>
        )
      })()}
      <Num
        label="поворот, °"
        value={selected.placement.rotation}
        unit=""
        onChange={(v) => commit((c) => place(c, selected.id, { rotation: v }))}
      />
      <p className="text-xs text-muted-foreground">высота {formatCm(heightCm(selected))} — следует за пропорцией</p>
      <p className="text-xs text-muted-foreground">стрелки двигают на 1 мм, с Shift — на 1 см</p>
    </Section>
  )

  const elementPanel = selected && <ElementPanel w={w} placement={placement} />
  const garmentPanel = <GarmentPanel w={w} />

  return (
    <>
      <WorkFrame label={`рабочее окно: ${title}`} bar={bar} onBackdrop={close} open={windowOpen}>
        <div
          ref={area}
          tabIndex={0}
          aria-label="холст изделия: Tab — по объектам, стрелки — сдвиг, ? — все клавиши"
          className="relative min-w-0 flex-1 overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ touchAction: 'none' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => void onDrop(e)}
          onPointerDownCapture={onAreaDown}
          onPointerMove={onAreaMove}
          onPointerUp={onAreaUp}
          onPointerCancel={() => (press.current = null)}
        >
          <div
            data-stage
            ref={stage}
            className="absolute inset-y-0 left-0 flex items-center justify-center"
            // Место под панель настроек занято всегда. Раньше холст сжимался,
            // когда панель открывалась, — а открывает её нажатие на принт, и
            // изделие меняло масштаб прямо под мышью: перетащить принт было
            // нельзя (правка владельца 25.09).
            style={{ right: PANEL_SPACE }}
          >
            <div style={{ width: box, height: box, position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: box * zoom,
                  height: box * zoom,
                  transform: `translate(${pan.x - (box * (zoom - 1)) / 2}px, ${pan.y - (box * (zoom - 1)) / 2}px)`,
                  cursor: zoom > 1 ? 'grab' : 'default',
                }}
              >
                {cover && (
                  <div className="pointer-events-none absolute inset-0 z-10 bg-background">
                    {cover !== 'blank' && <img src={cover} alt="" className="h-full w-full object-contain" />}
                  </div>
                )}
                <GarmentCanvas
                  state={state}
                  frameSrc={frameUrl(product.code, state.code)}
                  calibration={calibration}
                  composition={sized}
                  side={stateCode}
                  torso={torso}
                  anchorsBySide={anchorsBySide}
                  params={params}
                  renderScale={renderScale}
                  onFps={setFps}
                  showZones={overlay === 'zones' || overlay === 'all'}
                  field={fieldOutline}
                  fieldLabel={size ? `поле ${size}` : null}
                  hoodDownScale={hoodDownScale}
                  showAnchors={overlay === 'anchors' || overlay === 'all'}
                  onSelect={(id) => setComposition((c) => select(c, id))}
                  onMove={(id, dxCm, dyCm) => setComposition((c) => placeSized(c, id, { dxCm, dyCm }))}
                  onResize={(id, widthCm) => setComposition((c) => placeSized(c, id, { widthCm }))}
                  onRotate={(id, rotation) => setComposition((c) => place(c, id, { rotation }))}
                  onCommit={() => commit()}
                  onCanvas={(el) => (viewCanvas.current = el)}
                  images={images.current}
                  clips={clips}
                  imagesVersion={imagesVersion}
                />
                {(remarks.data ?? []).map((r, i) =>
                  r.side === stateCode && r.x !== null && r.y !== null && r.status !== 'accepted' ? (
                    <span
                      key={r.id}
                      data-remark-pin={r.id}
                      aria-label={`замечание ${i + 1}: ${r.text}`}
                      className={`pointer-events-none absolute z-20 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                        r.status === 'open' ? 'border-white bg-destructive text-white' : 'border-white bg-warning text-white'
                      } ${focusRemark === r.id ? 'ring-2 ring-primary' : ''}`}
                      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, transform: 'translate(-50%, -50%)' }}
                    >
                      {i + 1}
                    </span>
                  ) : null,
                )}
                {placing && (
                  <div
                    className="absolute inset-0 z-30"
                    style={{ cursor: 'crosshair' }}
                    aria-label="нажмите на принт, надпись или место изделия"
                    onClick={(e) => {
                      const layer = e.currentTarget
                      const box = layer.getBoundingClientRect()
                      const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
                      const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
                      // Какой слой под точкой — у холста спросить нечем, а у
                      // документа можно: слой накрытия на миг пропускает нажатие.
                      layer.style.pointerEvents = 'none'
                      const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.getAttribute('data-element-id'))
                      layer.style.pointerEvents = ''
                      const id = under?.getAttribute('data-element-id') ?? null
                      const el = id ? sized.elements.find((x) => x.id === id) : undefined
                      const name = el ? (el.kind === 'text' ? `«${el.text}»` : el.name) : null
                      setPendingRemark({ x, y, element_id: id, element_name: name })
                      setPlacing(false)
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {compareOpen && (
            <ColourCompare
              product={product}
              composition={sized}
              calibration={calibration}
              torso={torso}
              anchorsBySide={anchorsBySide}
              params={params}
              images={images.current}
              imagesVersion={imagesVersion}
              choices={colourChoices}
              fromDrop={refDropIds.length ? (catalogueDropName(refDropIds[0]) ?? null) : null}
              saving={saving}
              onSave={(picked, canvases) => void saveColours(picked, canvases)}
              onClose={() => setCompareOpen(false)}
            />
          )}

          {/* Что нанести — первым, слева сверху: ненайденная возможность равна отсутствующей. */}
          <div className="absolute left-3 top-3 flex gap-2">
            <button className={small()} onClick={addLabel}>
              + надпись
            </button>
            <button className={on(libraryOpen)} aria-expanded={libraryOpen} onClick={() => setLibraryOpen((v) => !v)}>
              + добавить
            </button>
          </div>
          {libraryOpen && (
            <div className="pf-card absolute bottom-3 left-3 top-14 w-80 overflow-hidden border border-line p-3 text-sm">
              <WorkPicker dropIds={refDropIds} prints={prints} onPick={pick} onFiles={(f) => void addFiles(f)} onSetPrint={(item) => void addFromSet(item)} />
            </div>
          )}

          {current && talkOpen && (
            <div
              ref={talkRef}
              role="dialog"
              aria-label="обсуждение"
              className="pf-card absolute bottom-24 left-1/2 z-40 flex max-h-[65%] w-[440px] max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-y-auto border border-line bg-background p-3 text-sm shadow-xl"
              onPointerDown={(e) => e.stopPropagation()}
            >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Обсуждение</h2>
              <button className={buttonClass({ tone: 'neutral', variant: 'outline', small: true })} onClick={() => setTalkOpen(false)} aria-label="скрыть обсуждение">
                ×
              </button>
            </div>
          {current && <AgendaSection card={current} />}
          {current && (
            <ReviewSection
              card={current}
              onChanged={(card) => {
                setCurrent(card)
                queries.setQueryData(cardKey(card.id), card)
                void queries.invalidateQueries({ queryKey: ['references'] })
                void queries.invalidateQueries({ queryKey: ['tasks'] })
              }}
            />
          )}

          {current && (
            <RemarksSection
              card={current}
              side={stateCode}
              sideName={(code) => product?.states.find((s) => s.code === code)?.display_name ?? code}
              remarks={remarks.data ?? []}
              focus={focusRemark}
              onFocus={setFocusRemark}
              placing={placing}
              onPlacing={setPlacing}
              pending={pendingRemark}
              onPending={setPendingRemark}
              onChanged={() => {
                void queries.invalidateQueries({ queryKey: ['remarks', current.id] })
                void queries.invalidateQueries({ queryKey: ['tasks'] })
              }}
            />
          )}

          {current && (
            <ExecutorSection
              card={current}
              onChanged={(card) => {
                setCurrent(card)
                queries.setQueryData(cardKey(card.id), card)
                void queries.invalidateQueries({ queryKey: ['references'] })
              }}
            />
          )}

            </div>
          )}

          {current && (
            <DecisionBar
              card={current}
              currentDrops={refDropIds}
              openRemarks={openRemarks}
              talkOpen={talkOpen}
              onTalk={setTalkOpen}
              onRemark={() => {
                setTalkOpen(true)
                setPendingRemark(FREE_REMARK)
              }}
              onChanged={(card) => {
                setCurrent(card)
                queries.setQueryData(cardKey(card.id), card)
                void queries.invalidateQueries({ queryKey: ['references'] })
                void queries.invalidateQueries({ queryKey: ['tasks'] })
              }}
            />
          )}

          {/* Виды — иконками изделия с принтом: что лежит на спине, видно до нажатия. */}
          <div className="absolute right-3 top-3 flex gap-2" aria-label="виды изделия">
            {product.states.map((s, i) => (
              <div key={s.code} className="flex flex-col items-center gap-0.5">
              {/* Подпись над иконкой: по картинке перед от спины отличают не все,
                  а подсказка при наведении видна не сразу. */}
              <span className={`text-[11px] ${s.code === state.code ? 'font-semibold' : 'text-muted-foreground'}`}>
                {s.display_name}
              </span>
              <button
                onClick={() => setStateCode(s.code)}
                aria-pressed={s.code === state.code}
                title={`${s.display_name}${s.kind === 'illustrative' ? ' — только показ, размещать по нему нельзя' : ''} · клавиша ${i + 1}`}
                className={`pf-card relative w-16 overflow-hidden border p-0.5 ${s.code === state.code ? 'border-primary ring-2 ring-primary' : 'border-line'}`}
              >
                <GarmentCanvas
                  preview
                  state={s}
                  frameSrc={frameUrl(product.code, s.code)}
                  calibration={calibration}
                  composition={thumbWork}
                  clips={clips}
                  side={s.code}
                  torso={torso}
                  anchorsBySide={anchorsBySide}
                  params={params}
                  renderScale={THUMB_SCALE}
                  showZones={false}
                  showAnchors={false}
                  onSelect={noop}
                  onMove={noop}
                  onResize={noop}
                  onRotate={noop}
                  images={images.current}
                  onCanvas={(el) => (thumbCanvases.current[s.code] = el)}
                  imagesVersion={imagesVersion}
                  key={s.code}
                />
                <span className="absolute left-1 top-0 text-[10px] text-muted-foreground">{i + 1}</span>
              </button>
              </div>
            ))}
          </div>

          <div
            className="pf-card absolute bottom-3 right-3 top-[112px] w-80 overflow-y-auto border border-line p-3 text-sm"
            aria-label={panel === 'element' ? 'настройки выбранного' : panel === 'garment' ? 'настройки изделия' : 'настройки'}
          >
            {panel === 'element' ? (
              elementPanel
            ) : panel === 'garment' ? (
              garmentPanel
            ) : (
              <p className="text-xs text-muted-foreground">
                Нажмите на принт или надпись — здесь появятся размер, положение и поворот; на изделие — его цвет, размер
                и показ. Tab — по объектам с клавиатуры.
              </p>
            )}
          </div>

          <div className="absolute bottom-3 flex max-w-lg flex-col gap-2" style={{ left: libraryOpen ? 312 : 12 }}>
            {visible.elements.length === 0 && (
              <p className="pf-card px-3 py-2 text-xs text-muted-foreground">
                {state.kind === 'illustrative'
                  ? 'Это иллюстративный ракурс: он показывает, но размещать по нему нельзя — силуэт сокращён, и размер в сантиметрах по нему соврёт.'
                  : 'Перетащите сюда картинки — можно несколько разом. Нажмите на изделие — его цвет и размер.'}
              </p>
            )}
            {dropHint && (
              <p role="status" className="pf-card flex gap-2 px-3 py-2 text-xs text-warning">
                <span className="flex-1">{dropHint}</span>
                <button onClick={() => setDropHint(null)} aria-label="скрыть подсказку">
                  ×
                </button>
              </p>
            )}
            {seen.length + seenCards.length > 0 && (
              <Recognised
                rows={[...cardRows(seenCards), ...fileRows(seen)]}
                onClose={() => {
                  setSeen([])
                  setSeenCards([])
                }}
              />
            )}
          </div>
        </div>


        <aside className="w-72 shrink-0 overflow-y-auto border-l border-line p-3 text-sm" aria-label="теги и история">
          <Section title="Теги">
            {!current && <p className="text-xs text-muted-foreground">свои теги — после первого сохранения</p>}
            {current && refTags && (
              <>
                <div className="flex flex-wrap gap-1">
                  {refTags.own.map((name) => (
                    <span key={name} className="rounded bg-primary-soft px-2 py-0.5 text-xs" title="свой тег — в поиске важнее автотегов">
                      {name}
                      <button className="ml-1 text-muted-foreground" aria-label={`убрать тег ${name}`} onClick={() => retag((id) => removeTag(id, name))}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <TextInput
                  value={tagDraft}
                  list="own-tag-hints"
                  placeholder="свой тег: школьная линейка…"
                  aria-label="добавить свой тег"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || !tagDraft.trim()) return
                    const name = tagDraft.trim()
                    setTagDraft('')
                    retag((id) => addTag(id, name))
                  }}
                />
                <datalist id="own-tag-hints">
                  {tagHints.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
              </>
            )}
            {autoTags.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="автотеги">
                {autoTags.map((tg) => (
                  <span key={tg.code} style={S.tagChip} title={`автотег, вес ${tg.score.toFixed(4)} · ${tg.model}`}>
                    {tg.name} <span style={S.tagScore}>{weightText(tg.score)}</span>
                    {current && (
                      <button
                        className="ml-1 text-muted-foreground"
                        title="Неверный — скрыть у этого референса: перестанет находить его в поиске"
                        aria-label={`скрыть автотег ${tg.name}`}
                        onClick={() => retag((id) => hideTag(id, tg.code, tg.name))}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {(refTags?.hidden.length ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                скрыто:{' '}
                {refTags!.hidden.map((h) => (
                  <button key={h.code} className="mr-1 underline" title="вернуть автотег" onClick={() => retag((id) => unhideTag(id, h.code))}>
                    {h.name}
                  </button>
                ))}
              </p>
            )}
          </Section>
          <Section title={`На изделии · ${SIDE_NAMES[stateCode] ?? stateCode}`}>
            {visible.elements.length === 0 && <p className="text-xs text-muted-foreground">на этой стороне пусто</p>}
            <div className="flex flex-col gap-1">
              {visible.elements.map((el) => (
                // Строка — не кнопка: у тегов свои кнопки, а кнопка в кнопке —
                // недопустимая разметка (React ругался в консоли, 26.09.2026).
                // Выбирает элемент кнопка с названием и значками, теги — рядом.
                <div
                  key={el.id}
                  className={`flex flex-wrap items-center gap-1 rounded border px-2 py-1 text-xs ${el.id === visible.selectedId ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover'}`}
                >
                <button
                  onClick={() => setComposition((c) => select(c, el.id))}
                  aria-pressed={el.id === visible.selectedId}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-left"
                >
                  <span className="min-w-0 flex-1 truncate" title={el.name}>
                    {el.kind === 'text' ? `«${el.text}»` : el.name}
                  </span>
                  {/* Шрифт виден у каждой надписи: чтобы сравнить две, не надо тыкать в каждую. */}
                  {el.kind === 'text' && (
                    <span style={{ ...S.badge, fontFamily: `"${el.fontFamily}", sans-serif` }}>{el.fontFamily}</span>
                  )}
                  {el.kind === 'image' && !el.hasAlpha && <span style={S.badge}>фон не вырезан</span>}
                  {refDropIds.length > 0 && board.data && !isApproved(el) && (
                    <span style={S.badge} title="Взято не из одобренного к дропу референса">
                      не одобрено к дропу
                    </span>
                  )}
                  {el.kind === 'image' && tagsOf[digestOf(el.src)]?.name && <NameChip named={tagsOf[digestOf(el.src)]!.name!} />}
                </button>
                  {el.kind === 'image' && (tagsOf[digestOf(el.src)]?.tags ?? []).length > 0 && (
                    <TagChips tags={tagsOf[digestOf(el.src)]!.tags} />
                  )}
                </div>
              ))}
            </div>
            {Object.keys(elsewhere).length > 0 && (
              <p className="text-xs text-muted-foreground">
                на других сторонах:{' '}
                {Object.entries(elsewhere)
                  .map(([code, n]) => `${SIDE_NAMES[code] ?? code} — ${n}`)
                  .join(', ')}
              </p>
            )}
          </Section>

          {current && viewing !== null && (
            <Section title={`История · ${current.versions.length}`}>
              <div className="flex flex-col gap-0.5">
                {draftHeld && (
                  <div className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${dirty ? 'bg-tone-amber-soft' : 'hover:bg-hover'}`}>
                    <button
                      className="flex-1 text-left"
                      aria-current={dirty}
                      disabled={dirty}
                      onClick={() => current && void showDraft(current, draftHeld)}
                      title={dirty ? 'на экране' : 'открыть черновик'}
                    >
                      несохранённые изменения
                      {draftHeld.base_number ? ` · поверх версии ${draftHeld.base_number}` : ''}
                    </button>
                    <button className={meaningClass('withdraw', true)} onClick={() => void discard()} title="Отбросить черновик — останутся версии">
                      отбросить
                    </button>
                  </div>
                )}
                {historyRows([...current.versions].reverse()).flatMap((row) => {
                  const one = (v: (typeof current.versions)[number]) => (
                    <button
                      key={v.number}
                      onClick={() => v.number !== viewing && goTo(v.number)}
                      aria-current={v.number === viewing}
                      className={`rounded px-2 py-1 text-left text-xs ${v.number === viewing ? 'bg-primary-soft' : 'hover:bg-hover'} ${v.auto_reason ? 'text-muted-foreground' : ''}`}
                    >
                      версия {v.number}
                      {v.auto_reason ? ` · авто: ${v.auto_reason}` : ''} ·{' '}
                      {v.author_name ?? (v.author_id ? 'имя ещё не пришло' : 'без входа')} ·{' '}
                      {new Date(v.saved_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </button>
                  )
                  if (row.kind === 'one') return [one(row.version)]
                  // Автоверсии подряд — одной строкой, пока их не раскрыли или
                  // пока одна из них не на экране (US-0599).
                  const top = row.versions[0].number
                  const shown = openAutos.has(top) || row.versions.some((v) => v.number === viewing)
                  return [
                    <button
                      key={`autos-${top}`}
                      className="rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-hover"
                      aria-expanded={shown}
                      onClick={() =>
                        setOpenAutos((s) => {
                          const next = new Set(s)
                          if (next.has(top)) next.delete(top)
                          else next.add(top)
                          return next
                        })
                      }
                    >
                      {shown ? '▾' : '▸'} автоверсии {row.versions[row.versions.length - 1].number}–{top} · {row.versions.length} шт.
                    </button>,
                    ...(shown ? row.versions.map(one) : []),
                  ]
                })}
              </div>
              {viewing !== current.number && (
                <p className="text-xs text-warning">не последняя: сохранение ляжет новой версией поверх последней</p>
              )}
              <p className="text-xs text-muted-foreground">Q и E — листать историю; A и D — соседние карточки</p>
            </Section>
          )}

          <Section title={`Проверки · ${open.length}`}>
            {open.length === 0 && composition.elements.length > 0 && (
              <p className="text-xs text-muted-foreground">находок нет</p>
            )}
            <div className="flex flex-col gap-1">
              {open.map((f) => (
                <div
                  key={keyOf(f)}
                  className={`flex items-start gap-1 rounded border-l-4 px-2 py-1 text-xs ${f.weight === 'blocking' ? 'border-destructive bg-destructive-soft' : 'border-warning bg-tone-amber-soft'}`}
                >
                  <button
                    className="flex-1 text-left"
                    title="Показать эту сторону и выбрать элемент"
                    onClick={() => {
                      setStateCode(f.side)
                      if (f.elementId) setComposition((c) => select(c, f.elementId!))
                    }}
                  >
                    <span className="text-muted-foreground">{SIDE_NAMES[f.side] ?? f.side}: </span>
                    {f.message}
                  </button>
                  {f.weight === 'warning' && (
                    <button
                      title="Так и задумано. Кто закрыл — появится вместе со входом платформы"
                      onClick={() => setDismissed((d) => new Set([...d, keyOf(f)]))}
                      className="text-muted-foreground"
                    >
                      ✓
                    </button>
                  )}
                </div>
              ))}
            </div>
            {dismissed.size > 0 && (
              <p className="text-xs text-muted-foreground">закрыто «так и задумано»: {dismissed.size}</p>
            )}
          </Section>

          <Section title="Выгрузка">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => void downloadSheet()}
                // Пока проверки не догнали работу, лист не выгружается: иначе
                // «находок нет» значило бы «ещё не считали».
                disabled={composition.elements.length === 0 || blocking(open).length > 0 || checked !== sized}
                className={small()}
                title={
                  checked !== sized
                    ? 'Проверки считаются…'
                    : blocking(open).length > 0
                      ? 'Сначала исправьте блокирующие находки: такой принт не пропечатается'
                      : current && dirty
                        ? `На фабрику уходит только версия: несохранённое станет версией ${current.number + 1}, её номер будет на листе`
                        : 'Плоский лист в сантиметрах, мимо складок и света — он идёт на фабрику'
                }
              >
                {/* Что будет сохранено — видно на кнопке, а не после (решение 0015). */}
                {current && dirty ? `печатный лист · сохранит версию ${current.number + 1}` : 'печатный лист'}
              </button>
              <button onClick={downloadSnapshot} className={small()} title="Изделие как его увидит человек — со складками, тенью и цветом">
                картинкой
              </button>
            </div>
            {composition.elements.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {/* Габарит ЭТОЙ стороны на ВЫБРАННОМ размере: лист выгружается
                    по сторонам и по размеру. */}
                {SIDE_NAMES[stateCode] ?? stateCode}
                {size ? `, ${size}` : ''}: {describeSheet(visible, clips).widthCm.toFixed(1)} ×{' '}
                {describeSheet(visible, clips).heightCm.toFixed(1)} см, элементов {describeSheet(visible, clips).items.length}
                {cal.provisional && ' · калибровка предварительная'}
              </p>
            )}
          </Section>
        </aside>
      </WorkFrame>


    </>
  )
}
