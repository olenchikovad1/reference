import { DataTable, type DataColumn } from '@platform/ui'
import { Modal, TextInput } from '@platform/ui'
import { toCss } from '../../shared/api/colours'
import { add, place, recrop, relook, remove, select, type ClipTo, restyle, retype } from '../../shared/composition'
import { FONTS } from '../../shared/fonts'
import { digestOf } from '../../shared/api/assets'
import { meaningClass } from '../../candidates/meaning'
import { newElementId, otherSide } from '../../shared/sides'
import { declaredInks, FULL, mainColoursOf, type CropShape, type Ink } from '../../shared/look'
import { CropBox } from '../../candidates/CropBox'
import { resetAtSize, scaleAt } from '../../shared/grading'
import { cropSummary } from './work'
import { Slider, Section } from './controls'
import { TagChips, NameChip, DefectPrint } from './recognised'
import { S } from './styles'
import { useState, type ReactNode } from 'react'
import type { WorkWindowState } from './useWorkWindow'
import { on, small } from './controls'

// Панель выбранного элемента (план 114 / US-0026): размещение на виду;
// тяжёлые краски и полная таблица градации — за отдельным входом.
export function ElementPanel({ w, placement }: { w: WorkWindowState; placement: ReactNode }) {
  const [inksOpen, setInksOpen] = useState(false)
  const [gradeOpen, setGradeOpen] = useState(false)
  const {
    product,
    stateCode,
    size,
    composition,
    setComposition,
    commit,
    colours,
    images,
    swapPick,
    setSwapPick,
    duoPick,
    setDuoPick,
    canDefect,
    tagsOf,
    state,
    grid,
    torso,
    clips,
    selected,
    cropMenu,
    setCropMenu,
    cropRef,
    cropOpen,
    setCropOpen,
    aspectOf,
    moveSelected,
  } = w
  // Панель видна только у выбранного элемента загруженного изделия (окно
  // раньше уже показало «загружаю» или ошибку).
  if (!selected || !product) return null
  const selectedImg = selected.kind === 'image' ? images.current.get(selected.src) : undefined
  const mains = selectedImg?.complete ? mainColoursOf(selectedImg) : []
  const inkOf = (code: string): Ink | null => {
    const c = colours.find((x) => x.code === code)
    return c ? { code: c.code, rgb: c.rgb } : null
  }
  const target = otherSide(selected.placement.side ?? 'front')
  // Градация по всем размерам сразу (раньше — рукописной таблицей; план 114).
  const gradeBase = composition.elements.find((e) => e.id === selected.id)
  const gradeRows = grid && gradeBase
    ? product.size_set.sizes.map((s) => ({ size: s, sc: scaleAt(gradeBase.placement, grid, s) }))
    : []
  const gradeColumns: DataColumn<(typeof gradeRows)[number]>[] = [
    { id: 'size', header: 'размер', sortable: false, cell: (r) => r.size },
    {
      id: 'k', header: 'масштаб', sortable: false, align: 'end',
      cell: (r) => <span className={r.sc.manual ? 'text-warning' : 'text-muted-foreground'}>×{r.sc.k.toFixed(3)}</span>,
    },
    { id: 'width', header: 'ширина', sortable: false, align: 'end', cell: (r) => `${((gradeBase?.placement.widthCm ?? 0) * r.sc.k).toFixed(1)} см` },
    {
      id: 'reset', header: '', sortable: false,
      // Исключение видно ВМЕСТЕ с тем, что было бы по сетке: иначе технолог,
      // сверяя с сеткой, «исправит» его обратно.
      cell: (r) =>
        r.sc.manual && gradeBase ? (
          <button
            className="text-muted-foreground"
            title={`вручную · по сетке ×${r.sc.byGrid.toFixed(3)} — вернуть к сетке`}
            onClick={() => commit((c) => place(c, gradeBase.id, resetAtSize(gradeBase.placement, r.size)))}
          >
            ↺
          </button>
        ) : null,
    },
  ]
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate" title={selected.name}>
          {selected.kind === 'text' ? 'Надпись' : selected.name}
        </strong>
        <button className={small()} onClick={() => setComposition((c) => select(c, null))} aria-label="снять выбор">
          ×
        </button>
      </div>
      {selected.kind === 'image' && canDefect && <DefectPrint key={selected.src} src={selected.src} name={selected.name} />}
      {selected.kind === 'image' && (
        <Section title="Цвет и прозрачность">
          {/* Исходник не меняется: хранятся краска и прозрачность (US-0502). */}
          <div style={S.swatches}>
            {/* Первой — «как в оригинале» (владелец 29.09): вернуть исходный
                цвет не только Ctrl+Z. */}
            <button
              title="Как в оригинале — без краски"
              aria-label="как в оригинале"
              aria-pressed={!selected.look?.tint}
              onClick={() => commit((comp) => relook(comp, selected.id, { tint: null }))}
              style={{ ...S.swatch, ...S.original, outline: !selected.look?.tint ? '2px solid currentColor' : undefined }}
            />
            {colours.map((c) => (
              <button
                key={c.code}
                title={`${c.name} · ${c.code}`}
                aria-label={`перекрасить в ${c.group}`}
                onClick={() => commit((comp) => relook(comp, selected.id, { tint: { code: c.code, rgb: c.rgb } }))}
                style={{
                  ...S.swatch,
                  background: toCss(c),
                  outline: c.code === selected.look?.tint?.code ? '2px solid currentColor' : undefined,
                }}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selected.look?.tint
              ? `перекрашен в ${colours.find((c) => c.code === selected.look?.tint?.code)?.group ?? selected.look.tint.code} — форма и полутона те же`
              : 'исходный цвет — для одноцветного принта выберите краску'}
          </p>
          <Slider
            label="прозрачность"
            hint="насколько сквозь принт видна ткань: 0 — принт закрывает её полностью"
            value={Math.round((1 - (selected.look?.opacity ?? 1)) * 100) / 100}
            min={0}
            max={0.9}
            step={0.05}
            digits={2}
            onChange={(v) => commit((comp) => relook(comp, selected.id, { opacity: 1 - v }))}
          />
        </Section>
      )}
      {/* Обрезка — одной строкой со значком (владелец 29.09): нужна редко, а
          картинка обрезки занимала полпанели. Выбор — по нажатию, своя
          обрезка — в небольшом окне. */}
      <div ref={cropRef} className="relative mb-2">
        <button
          className={`${small()} w-full justify-start`}
          aria-expanded={cropMenu}
          onClick={() => setCropMenu((v) => !v)}
          title="Как обрезать принт"
        >
          <span aria-hidden>✂</span> обрезка: {cropSummary(selected, clips.has(selected.id))}
        </button>
        {cropMenu && (
          <div className="pf-card absolute left-0 right-0 top-full z-30 mt-1 flex flex-col gap-1 border border-line bg-background p-2 text-xs shadow-lg">
            <span className="text-muted-foreground">по разметке изделия</span>
            <div className="flex flex-wrap gap-1">
          {(
            [
              [null, 'не обрезать'],
              ['field', 'по печатному полю'],
              ...(state?.lines?.zipper
                ? ([
                    ['zipper-left', 'левее молнии'],
                    ['zipper-right', 'правее молнии'],
                  ] as const)
                : []),
              ...(torso?.views[stateCode] ? ([['seams', 'по боковым швам']] as const) : []),
            ] as [ClipTo | null, string][]
          ).map(([clip, name]) => (
            <button
              key={name}
              className={on((selected.placement.clip ?? null) === clip)}
              onClick={() => {
                commit((c) => place(c, selected.id, { clip }))
                setCropMenu(false)
              }}
            >
              {name}
            </button>
          ))}
            </div>
            {selected.placement.clip && !clips.has(selected.id) && (
              <p className="text-muted-foreground">на этой стороне такой разметки нет — принт не обрезан</p>
            )}
            {selected.kind === 'image' && (
              <button
                className={`${small()} self-start`}
                onClick={() => {
                  setCropMenu(false)
                  setCropOpen(true)
                }}
              >
                своя обрезка…
              </button>
            )}
          </div>
        )}
      </div>
      {selected.kind === 'image' && (
        <Modal
          open={cropOpen}
          onClose={() => setCropOpen(false)}
          title={`Обрезка · ${selected.name}`}
          actions={
            <button className={meaningClass('act')} onClick={() => setCropOpen(false)}>
              готово
            </button>
          }
        >
          {/* Кусок исходника в его долях (US-0504): раздвинуть обратно можно
              всегда, исходник цел; печатный лист режет тот же кусок. */}
          <div className="flex flex-col gap-2 text-xs">
          <CropBox
            src={selected.src}
            sourceAspect={selected.aspect * ((selected.look?.crop ?? FULL).h / (selected.look?.crop ?? FULL).w)}
            crop={selected.look?.crop ?? FULL}
            onChange={(crop, done) => (done ? commit : setComposition)((c) => recrop(c, selected.id, crop))}
          />
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['rect', 'прямоугольник'],
                ['ellipse', 'круг'],
                ['hexagon', 'шестиугольник'],
              ] as [CropShape, string][]
            ).map(([shape, name]) => (
              <button
                key={shape}
                className={on((selected.look?.crop?.shape ?? 'rect') === shape)}
                onClick={() => commit((c) => recrop(c, selected.id, { ...(selected.look?.crop ?? FULL), shape }))}
              >
                {name}
              </button>
            ))}
            <button className={small()} onClick={() => commit((c) => recrop(c, selected.id, FULL))}>
              вся картинка
            </button>
            <button
              className={small()}
              title="Ещё один кусок того же исходника — своей обрезкой, без копии файла"
              onClick={() =>
                commit((c) => {
                  const id = newElementId()
                  const copy = add(c, {
                    ...selected,
                    id,
                    placement: { ...selected.placement, dxCm: selected.placement.dxCm + selected.placement.widthCm + 2 },
                  })
                  return recrop(copy, id, { x: 0.25, y: 0.25, w: 0.5, h: 0.5, shape: 'ellipse' })
                })
              }
            >
              второй кусок
            </button>
          </div>
          </div>
        </Modal>
      )}
      {selected.kind === 'image' && (
        <button className={`${small()} mb-1`} aria-expanded={inksOpen} onClick={() => setInksOpen((v) => !v)}>
          {inksOpen ? 'свернуть краски' : 'краски принта'}
        </button>
      )}
      {selected.kind === 'image' && inksOpen && (
        <Section title="Краски">
          {/* Многоцветный принт (US-0503): основные краски находятся сами, каждая
              меняется на краску палитры; тон и дуотон — поверх. Исходник тот же. */}
          <p className="text-xs text-muted-foreground">
            основные краски: {mains.length}
            {' · '}
            {declaredInks(selected.look)
              ? `красок после правки: ${declaredInks(selected.look)!.length}`
              : 'краски не объявлены — замените все или сделайте дуотон, тогда проверка их посчитает'}
          </p>
          <div className="flex flex-wrap gap-1">
            {mains.map((m, i) => {
              const to = selected.look?.swaps?.[i]?.to
              return (
                <button
                  key={i}
                  aria-pressed={swapPick === i}
                  onClick={() => setSwapPick(swapPick === i ? null : i)}
                  title={to ? `заменена на ${to.code}` : `доля ${Math.round(m.share * 100)}% — нажмите, чтобы заменить`}
                  style={{ ...S.swatch, background: `rgb(${(to?.rgb ?? m.rgb).join(',')})`, outline: swapPick === i ? '2px solid currentColor' : undefined }}
                />
              )
            })}
          </div>
          {swapPick !== null && mains[swapPick] && (
            <>
              <p className="text-xs text-muted-foreground">заменить эту краску на краску палитры:</p>
              <div style={S.swatches}>
                {colours.map((c) => (
                  <button
                    key={c.code}
                    title={`${c.name} · ${c.code}`}
                    aria-label={`заменить на ${c.group}`}
                    onClick={() =>
                      commit((comp) =>
                        relook(comp, selected.id, {
                          tint: null,
                          duotone: null,
                          swaps: mains.map((m, i) => ({
                            from: m.rgb,
                            to: i === swapPick ? inkOf(c.code) : (selected.look?.swaps?.[i]?.to ?? null),
                          })),
                        }),
                      )
                    }
                    style={{ ...S.swatch, background: toCss(c) }}
                  />
                ))}
              </div>
              <button
                className={small()}
                onClick={() =>
                  commit((comp) =>
                    relook(comp, selected.id, {
                      swaps: mains.map((m, i) => ({ from: m.rgb, to: i === swapPick ? null : (selected.look?.swaps?.[i]?.to ?? null) })),
                    }),
                  )
                }
              >
                эту краску как есть
              </button>
            </>
          )}
          <Slider label="оттенок" hint="сдвигает все цвета принта вместе по кругу: соотношения между ними те же" value={selected.look?.hue ?? 0} min={-180} max={180} step={5} digits={0} onChange={(v) => commit((c) => relook(c, selected.id, { hue: v }))} />
          <Slider label="насыщенность" hint="насколько цвета яркие: меньше — ближе к серому, больше — сочнее" value={selected.look?.saturation ?? 0} min={-1} max={1} step={0.05} digits={2} onChange={(v) => commit((c) => relook(c, selected.id, { saturation: v }))} />
          <Slider label="контраст" hint="насколько светлое отличается от тёмного: меньше — принт мягче, приглушённее" value={selected.look?.contrast ?? 0} min={-0.8} max={1} step={0.05} digits={2} onChange={(v) => commit((c) => relook(c, selected.id, { contrast: v }))} />
          <Slider label="яркость" hint="светлее или темнее весь принт целиком" value={selected.look?.brightness ?? 0} min={-0.8} max={0.8} step={0.05} digits={2} onChange={(v) => commit((c) => relook(c, selected.id, { brightness: v }))} />
          <Slider label="теплота" hint="больше — теплее, в красный и жёлтый; меньше — холоднее, в синий" value={selected.look?.warmth ?? 0} min={-1} max={1} step={0.05} digits={2} onChange={(v) => commit((c) => relook(c, selected.id, { warmth: v }))} />
          <p className="text-xs text-muted-foreground">дуотон — принт в две-три краски по яркости: выберите их</p>
          <div style={S.swatches}>
            {colours.map((c) => (
              <button
                key={c.code}
                title={`${c.name} · ${c.code}`}
                aria-label={`краска дуотона ${c.group}`}
                aria-pressed={duoPick.includes(c.code)}
                onClick={() => setDuoPick((d) => (d.includes(c.code) ? d.filter((x) => x !== c.code) : d.length < 3 ? [...d, c.code] : d))}
                style={{ ...S.swatch, background: toCss(c), outline: duoPick.includes(c.code) ? '2px solid currentColor' : undefined }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              className={small()}
              disabled={duoPick.length < 2}
              onClick={() =>
                commit((c) =>
                  relook(c, selected.id, { tint: null, swaps: undefined, duotone: duoPick.flatMap((code) => inkOf(code) ?? []) }),
                )
              }
            >
              дуотон из выбранных ({duoPick.length})
            </button>
            {duoPick.length > 0 && (
              <button className={small()} onClick={() => setDuoPick([])}>
                снять выбор
              </button>
            )}
            {selected.look?.duotone && (
              <button className={small()} onClick={() => commit((c) => relook(c, selected.id, { duotone: null }))}>
                убрать дуотон
              </button>
            )}
            <button
              className={small()}
              onClick={() =>
                commit((c) =>
                  relook(c, selected.id, {
                    tint: null, swaps: undefined, duotone: null, hue: 0, saturation: 0, contrast: 0, brightness: 0, warmth: 0,
                  }),
                )
              }
            >
              вернуть исходный
            </button>
            <button
              className={small()}
              title="Копия этого принта рядом — сравнить два варианта на одном изделии"
              onClick={() =>
                commit((c) =>
                  add(c, {
                    ...selected,
                    id: newElementId(),
                    placement: { ...selected.placement, dxCm: selected.placement.dxCm + selected.placement.widthCm + 2 },
                  }),
                )
              }
            >
              копия рядом
            </button>
          </div>
        </Section>
      )}
      {selected.kind === 'image' && (
        <div className="mb-2 flex flex-wrap gap-1">
          {!selected.hasAlpha && <span style={S.badge}>фон не вырезан</span>}
          {tagsOf[digestOf(selected.src)]?.name && <NameChip named={tagsOf[digestOf(selected.src)]!.name!} />}
          {(tagsOf[digestOf(selected.src)]?.tags ?? []).length > 0 && <TagChips tags={tagsOf[digestOf(selected.src)]!.tags} />}
        </div>
      )}
      {selected.kind === 'text' && (
        <Section title="Текст, шрифт, цвет">
          <TextInput
            value={selected.text}
            aria-label="текст надписи"
            onChange={(e) => {
              const text = e.target.value
              commit((c) => {
                const next = retype(c, selected.id, text)
                return restyle(next, selected.id, { textAspect: aspectOf({ ...selected, text }) })
              })
            }}
          />
          <div className="flex flex-wrap gap-1">
            {FONTS.map((f) => (
              <button
                key={f.family}
                title={`${f.role} · ${f.license}`}
                onClick={() =>
                  commit((c) =>
                    restyle(c, selected.id, {
                      fontFamily: f.family,
                      textAspect: aspectOf({ ...selected, fontFamily: f.family }),
                    }),
                  )
                }
                className={on(f.family === selected.fontFamily)}
                style={{ fontFamily: `"${f.family}", sans-serif` }}
              >
                {f.family}
              </button>
            ))}
          </div>
          <div style={S.swatches}>
            {colours.map((c) => (
              <button
                key={c.code}
                title={`${c.name} · ${c.code}`}
                aria-label={`цвет надписи ${c.group}`}
                onClick={() => commit((comp) => restyle(comp, selected.id, { colourCode: c.code, rgb: c.rgb }))}
                style={{
                  ...S.swatch,
                  background: toCss(c),
                  outline: c.code === selected.colourCode ? '2px solid currentColor' : undefined,
                }}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">шрифты только загруженные в систему, лицензия названа у каждого</p>
        </Section>
      )}
      {placement}
      {target && (
        <button className={small()} onClick={() => moveSelected(target)} title="Тот же размер и высота на другой стороне; Ctrl+Z вернёт">
          перенести на {target === 'back' ? 'спину' : 'перед'}
        </button>
      )}
      {grid && (
        <button className={`${small()} mb-1`} aria-expanded={gradeOpen} onClick={() => setGradeOpen((v) => !v)}>
          {gradeOpen ? 'свернуть градацию' : 'градация по размерам'}
        </button>
      )}
      {grid && gradeOpen && (
        <Section title="Градация">
          {/* Таблица по всем размерам сразу: технолог сверяет её с размерной
              сеткой, а не перебирает размеры по одному. */}
          {/* Постраничность выключена: ряд размеров — дюжина строк, весь виден сразу. */}
          <DataTable
            pagination="off"
            rows={gradeRows}
            columns={gradeColumns}
            rowKey={(r) => String(r.size)}
            selected={(r) => r.size === size}
            empty="Размерного ряда в описании изделия нет."
          />
          <p className="text-xs text-muted-foreground">
            база — {grid.base}
            {grid.provisional ? ' · сетка предварительная: ' + grid.method : ''}
          </p>
        </Section>
      )}
      <div className="mt-3">
        <button className={small('danger')} onClick={() => commit((c) => remove(c, selected.id))} title="Delete">
          убрать с изделия
        </button>
      </div>
    </>
  )
}
