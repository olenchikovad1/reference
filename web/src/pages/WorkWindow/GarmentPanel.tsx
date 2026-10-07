import { type Overlay } from './constants'
import { toCss } from '../../shared/api/colours'
import { sizesWithField } from '../../shared/fields'
import { download, upload } from './work'
import { Slider, Section } from './controls'
import { S } from './styles'
import type { WorkWindowState } from './useWorkWindow'
import { on, small } from './controls'

// Панель изделия (план 114, US-0894): цвет, размер, показ. Состояние — у окна.
export function GarmentPanel({ w }: { w: WorkWindowState }) {
  const {
    product,
    stateCode,
    size,
    setSize,
    overlay,
    setOverlay,
    params,
    setParams,
    renderScale,
    fps,
    colours,
    colourCode,
    setColourCode,
    setGarmentPicked,
    state,
    field,
  } = w
  // Изделие загружено: окно раньше уже показало «загружаю» или ошибку.
  if (!product || !state) return null
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1">Изделие</strong>
        <button className={small()} onClick={() => setGarmentPicked(false)} aria-label="закрыть настройки изделия">
          ×
        </button>
      </div>
      <Section title="Цвет">
        <div style={S.swatches}>
          {colours.map((c) => (
            <button
              key={c.code}
              title={`${c.name} · ${c.code}`}
              aria-label={`цвет изделия ${c.group}`}
              onClick={() => setColourCode(c.code)}
              style={{
                ...S.swatch,
                background: toCss(c),
                outline: c.code === colourCode ? '2px solid currentColor' : undefined,
              }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {colours.find((c) => c.code === colourCode)?.group ?? colourCode} · на фабрику уходит код, а не оттенок с экрана
        </p>
      </Section>
      <Section title="Размер">
        <div className="flex flex-wrap gap-1">
          {product.size_set.sizes.map((s) => {
            const known = sizesWithField(product.print_fields ?? null, stateCode).includes(s)
            return (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={on(s === size)}
                // Размер без поля показан бледным, а не спрятан: спрятанный
                // выглядит несуществующим, а технолог просто не дал для него поля.
                style={{ opacity: known ? 1 : 0.45 }}
                title={known ? '' : 'поля для этого размера нет — спросить технолога'}
              >
                {s}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {size === null
            ? 'Размер не выбран: поле считается по зоне кадра, а она нарисована для одного размера.'
            : field
              ? `Поле ${product.print_fields?.by_size?.[String(size)]?.[stateCode]?.join(' × ')} см` +
                (product.print_fields?.provisional ? ' · предварительно, от технолога ещё не подтверждено' : '')
              : 'Для этого размера поля нет — считаем по зоне кадра. Число придёт от технолога.'}
        </p>
        <p className="text-xs text-muted-foreground">
          {/* Отрисованный размер и выбранный — разные вещи: кадр один, и
              растягивать его под размер нельзя. */}
          Отрисован{' '}
          {product.rendered_size
            ? `${product.rendered_size}`
            : `предположительно ${product.rendered_size_assumed} — в именах кадров размера нет`}
        </p>
      </Section>
      <Section title="Показ">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setParams((p) => ({ ...p, effects: !p.effects }))} className={on(params.effects)}>
            {params.effects ? 'с эффектами' : 'без эффектов'}
          </button>
          <button
            onClick={() => setParams((p) => ({ ...p, through: !p.through }))}
            className={on(params.through)}
            title="Часть принта, которую закрывает капюшон. Обычно скрыта — как на изделии. Включите, чтобы увидеть бледно, где она лежит"
          >
            {params.through ? 'под капюшоном: видно бледно' : 'под капюшоном: скрыто'}
          </button>
        </div>
        <Slider label="гамма базы" hint="насколько темнеет ткань в складках: меньше — складки глубже" value={params.baseGamma} min={0.3} max={1.5} step={0.05} digits={2} onChange={(v) => setParams((p) => ({ ...p, baseGamma: v }))} />
        <Slider label="блики" hint="сколько света ткань отражает на выпуклостях: 0 — совсем матовая" value={params.specAmount} min={0} max={1} step={0.05} digits={2} onChange={(v) => setParams((p) => ({ ...p, specAmount: v }))} />
        <Slider label="смещение" hint="насколько принт изгибается по складкам: 0 — лежит плоско, как наклейка" value={params.displace} min={0} max={1} step={0.01} digits={2} onChange={(v) => setParams((p) => ({ ...p, displace: v }))} />
        <Slider label="затенение" hint="насколько тени складок ложатся на сам принт: 0 — принт ровный, без теней" value={params.shade} min={0} max={1} step={0.05} digits={2} onChange={(v) => setParams((p) => ({ ...p, shade: v }))} />
        <Slider label="гамма тени" hint="где кончается тень: больше — тени короче и только в глубоких складках" value={params.shadeGamma} min={0.4} max={2.5} step={0.05} digits={2} onChange={(v) => setParams((p) => ({ ...p, shadeGamma: v }))} />
        <div className="flex flex-wrap gap-1">
          {(['all', 'anchors', 'zones', 'none'] as Overlay[]).map((o) => (
            <button key={o} onClick={() => setOverlay(o)} className={on(o === overlay)}>
              {{ all: 'всё', anchors: 'ориентиры', zones: 'зоны', none: 'ничего' }[o]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => download(params)} className={small()} title="Подбор показа — файлом, чтобы вернуть его на другом компьютере">
            выгрузить подбор
          </button>
          <label className={small()}>
            вернуть подбор
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f).then(setParams).catch(() => undefined)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          отрисовка {Math.round(state.frame.width * renderScale)} px{fps !== null && ` · ${fps} кадр/с`}
        </p>
      </Section>
    </>
  )
}
