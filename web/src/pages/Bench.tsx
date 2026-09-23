import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GarmentCanvas } from '../candidates/GarmentCanvas'
import { DEFAULT_PARAMS, type RenderParams } from '../candidates/renderer'
import { fetchPalette, toCss, toUnit, type Colour } from '../shared/api/colours'
import { fetchPrints, printUrl, type PrintItem } from '../shared/api/prints'
import { fetchProduct, frameUrl, type Product } from '../shared/api/products'
import {
  EMPTY,
  add,
  find,
  heightCm,
  nudge,
  place,
  remove,
  select,
  type Composition,
  restyle,
  retype,
  type ImageElement,
  type TextElement,
} from '../shared/composition'
import { DEFAULT_FONT, FONTS } from '../shared/fonts'
import { formatCm } from '../shared/geometry'
import { measureAspect } from '../shared/text'
import type { Match } from '../shared/api/assets'
import { assetUrl, recogniseAssets, uploadAssets } from '../shared/api/assets'
import { readDropped } from '../shared/dropped'
import { forget, load, save } from '../shared/saved'
import { blocking, check, type Finding } from '../shared/checks'
import { describe as describeSheet, render as renderSheet } from '../shared/sheet'
import { useHistoryState } from '../shared/useHistory'

// Стенд нанесения. Кадр изделия, на него бросают картинки, их двигают и мерят
// в сантиметрах. Складки и тень приедут следующей историей — здесь проверяется,
// что сантиметры стыкуются с кадром и что этим можно пользоваться руками.

const PRODUCT = 'B-HDY-14'
type Overlay = 'none' | 'anchors' | 'zones' | 'all'

export function Bench() {
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stateCode, setStateCode] = useState('front')
  const [overlay, setOverlay] = useState<Overlay>('zones')
  const history = useHistoryState<Composition>(EMPTY)
  const composition = history.value
  // Живое изменение — без записи; шаг закрепляется там, где действие кончилось.
  const setComposition = history.set
  const commit = history.commit
  const [dropHint, setDropHint] = useState<string | null>(null)
  const [params, setParams] = useState<RenderParams>(DEFAULT_PARAMS)
  const [renderScale, setRenderScale] = useState(2)
  const [fps, setFps] = useState<number | null>(null)
  const [colours, setColours] = useState<Colour[]>([])
  const [colourCode, setColourCode] = useState('WHITE')
  const [fontsReady, setFontsReady] = useState(false)
  const [prints, setPrints] = useState<PrintItem[]>([])
  // Кэш картинок один на страницу: им пользуются и холст, и печатный лист.
  const images = useRef(new Map<string, HTMLImageElement>())
  const [imagesVersion, setImagesVersion] = useState(0)
  const [restored, setRestored] = useState(false)
  // Узнанное. Пусто — окна нет вовсе: окно «совпадений нет» превращает
  // подсказку в помеху, и его перестают читать вместе с полезными.
  const [seen, setSeen] = useState<Match[]>([])
  // Закрытые предупреждения: «так и задумано». Ключ — правило плюс элемент.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const viewCanvas = useRef<HTMLCanvasElement | null>(null)
  const measurer = useRef<CanvasRenderingContext2D | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    fetchProduct(PRODUCT).then(setProduct).catch((e: Error) => setError(e.message))
    fetchPalette()
      .then((p) => setColours(p.colors))
      .catch(() => undefined)
    fetchPrints()
      .then(setPrints)
      .catch(() => undefined)
    // Браузер грузит шрифт лениво — до первого применения. Без явного ожидания
    // первая отрисовка надписи уходит в запасной шрифт, то есть показывает не
    // то, что уйдёт в печать, и заметить это трудно: буквы-то на месте.
    const was = load()
    if (was) {
      setStateCode(was.stateCode)
      setColourCode(was.colourCode)
      for (const el of was.composition.elements) {
        if (el.kind === 'image') cacheImage(el.src)
      }
      commit(was.composition)
      setRestored(true)
    }
    void Promise.all(FONTS.map((f) => document.fonts.load(`600 100px "${f.family}"`)))
      .then(() => setFontsReady(true))
      .catch(() => setFontsReady(true))
  }, [])

  const state = product?.states.find((s) => s.code === stateCode) ?? product?.states[0] ?? null
  const calibration = useMemo(
    () => ({ pxPerCm: product?.calibration.px_per_cm ?? 1, provisional: true }),
    [product],
  )
  const selected = find(composition, composition.selectedId)

  // Сохраняем то, что закреплено. Живое перетаскивание не пишем: писать
  // десятки раз в секунду незачем, а отличить закреплённое от живого умеет
  // только тот, кто менял.
  useEffect(() => {
    if (composition.elements.length === 0) return
    save({ version: 1, stateCode, colourCode, composition })
  }, [composition, stateCode, colourCode])
  // Пороги приходят из описания изделия, а не из кода.
  const rules = product?.print_rules
  const findings = check(
    composition,
    rules
      ? {
          minLetterCm: rules.min_letter_cm,
          warnLetterCm: rules.warn_letter_cm,
          minStrokeCm: rules.min_stroke_cm,
          maxColours: rules.max_colours,
        }
      : undefined,
  )
  const keyOf = (f: Finding) => `${f.rule}:${f.elementId ?? '-'}`
  const open = findings.filter((f) => !dismissed.has(keyOf(f)))

  // Когда шрифты доехали, пропорции надписей пересчитываются: измеренные по
  // запасному шрифту они неверны, и надпись оказалась бы не той ширины.
  useEffect(() => {
    if (!fontsReady) return
    setComposition((c) =>
      c.elements.reduce(
        (acc, el) => (el.kind === 'text' ? restyle(acc, el.id, { textAspect: aspectOf(el) }) : acc),
        c,
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady])

  /** Пропорция надписи меряется по отрисованному: вычислить её из текста нельзя. */
  function aspectOf(t: Pick<TextElement, 'text' | 'fontFamily' | 'weight' | 'rgb'>): number {
    if (!measurer.current) {
      measurer.current = document.createElement('canvas').getContext('2d')
    }
    return measurer.current ? measureAspect(measurer.current, t) : 4
  }

  /** Принт из набора — одним нажатием. Путь через проводник убивает привычку
   *  на второй день, а эталонами пользуются постоянно. */
  function addFromSet(item: PrintItem) {
    const img = new Image()
    img.onload = () => {
      seq.current += 1
      cacheImage(img.src)
      commit((c) =>
        add(c, {
          id: `el-${seq.current}`,
          kind: 'image',
          name: item.name,
          src: img.src,
          aspect: img.naturalWidth / img.naturalHeight,
          // Эталон считается вырезанным: он нарисован кодом и прозрачность у
          // него настоящая, кроме того, который её нарочно не имеет.
          hasAlpha: item.name !== 'fon-ne-vyrezan.png',
          placement: {
            anchor: 'neck',
            dxCm: 0,
            dyCm: 12,
            // У эталона размер известен и обязан соблюдаться: сетка в 20 см
            // проверяет калибровку только если ложится двадцатью сантиметрами.
            widthCm: item.width_cm ?? 18,
            rotation: 0,
          },
        }),
      )
    }
    img.src = printUrl(item.path)
  }

  /** Кладёт картинку в общий кэш и будит тех, кто её ждёт. */
  function cacheImage(src: string) {
    if (images.current.has(src)) return
    const img = new Image()
    img.onload = () => setImagesVersion((v) => v + 1)
    img.src = src
    images.current.set(src, img)
  }

  /** Печатный лист: сборка из сантиметров, мимо шейдера, в печатном разрешении. */
  function downloadSheet() {
    if (composition.elements.length === 0) return
    // 120 пикселей на сантиметр — около 300 точек на дюйм, обычное печатное
    // разрешение. Число названо здесь, а не спрятано: оно уйдёт на фабрику.
    const spec = describeSheet(composition)
    const canvas = renderSheet(composition, images.current, 120)

    // Пометка о предварительной калибровке НЕ впечатывается в лист: его
    // напечатают вместе с ней. Она уходит в имя файла и в сопроводительную
    // спецификацию — от файла они не отвяжутся, а на ткань не попадут.
    const mark = cal.provisional ? '-PREDVARITELNO' : ''
    const stem = PRODUCT + '-' + stateCode + mark

    const save = (blob: Blob, name: string) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    }

    const lines = [
      'Изделие: ' + PRODUCT + ', состояние: ' + stateCode,
      'Габарит печати: ' + spec.widthCm.toFixed(1) + ' x ' + spec.heightCm.toFixed(1) + ' см',
      'Разрешение файла: 120 px/см (около 300 dpi)',
      cal.provisional
        ? 'ВНИМАНИЕ: калибровка изделия предварительная (' +
          cal.px_per_cm +
          ' px/см, ' +
          (cal.derived_from ?? '') +
          '). Размеры ниже уточнятся после измерения.'
        : 'Калибровка изделия измерена.',
      '',
      ...spec.items.map(
        (i) =>
          '- ' +
          i.name +
          ': ' +
          i.widthCm.toFixed(1) +
          ' x ' +
          i.heightCm.toFixed(1) +
          ' см, от ориентира ' +
          i.anchor +
          ': вниз ' +
          i.dyCm.toFixed(1) +
          ' см, вбок ' +
          i.dxCm.toFixed(1) +
          ' см, поворот ' +
          i.rotation +
          ' град',
      ),
    ]
    save(new Blob([lines.join(String.fromCharCode(10))], { type: 'text/plain' }), stem + '-specifikaciya.txt')
    canvas.toBlob((blob) => blob && save(blob, stem + '-pechatnyy-list.png'), 'image/png')
  }

  /**
   * Снимок стенда картинкой.
   *
   * Стенд живёт в докере на одной машине, и показать его команде можно только
   * позвав людей к экрану. Картинку кидают в мессенджер — значит мнение
   * Виктории и редакторов появится сейчас, а не через два месяца, когда
   * система будет готова их принять.
   *
   * Это НЕ печатный лист: тот плоский и идёт на фабрику, а здесь изделие со
   * складками, тенью и цветом — как его увидит человек.
   */
  function downloadSnapshot() {
    const canvas = viewCanvas.current
    if (!canvas) return
    const colour = colours.find((c) => c.code === colourCode)?.code_short ?? colourCode
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      // Имя говорит, что на снимке: три снимка в мессенджере без подписей
      // неразличимы, и обсуждение превращается в «а это какой из них».
      a.download = `${PRODUCT}-${stateCode}-${colour}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  function addLabel() {
    seq.current += 1
    const style = {
      text: 'ЗИМА 2026',
      fontFamily: DEFAULT_FONT.family,
      weight: 600,
      rgb: [255, 255, 255] as const,
    }
    const el: TextElement = {
      id: `el-${seq.current}`,
      kind: 'text',
      name: 'надпись',
      ...style,
      colourCode: 'WHITE',
      textAspect: aspectOf(style),
      placement: { anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
    }
    commit((c) => add(c, el))
  }

  // Клавиши: мышкой удобно искать, но попасть в «12 см ниже горловины» ею
  // нельзя, а это основной способ работы.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (!composition.selectedId) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const step = e.shiftKey ? 1 : 0.1
      const by: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      if (e.key in by) {
        e.preventDefault()
        const [dx, dy] = by[e.key]
        commit((c) => nudge(c, c.selectedId as string, dx, dy))
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        commit((c) => remove(c, c.selectedId as string))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composition.selectedId, history])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
      if (files.length === 0) return
      const read = await Promise.all(files.map(readDropped))
      // Файлы уходят в хранилище: ссылка на ступень переживает перезагрузку,
      // а ссылка на blob — нет.
      let sources = read.map((d) => d.src)
      try {
        const stored = await uploadAssets(files)
        sources = stored.map((a) => assetUrl(a.digest, 'preview'))
        // Тот же ФАЙЛ виден сразу: его поймал хеш, модель для этого не
        // нужна. Вектор ловит другое — ту же картинку в другом файле, — и эти
        // две сети не подменяют друг друга.
        const repeats: Match[] = stored
          .filter((a) => a.reused)
          .map((a) => ({ digest: a.digest, name: a.name, similarity: 1, level: 'file' as const }))
        setSeen(repeats)
        // Узнавание НЕ ожидается: человек бросил картинки и работает дальше,
        // а окно появится, когда модель досчитает.
        void recogniseAssets(stored.map((a) => a.digest))
          .then((rows) => setSeen([...repeats, ...rows.flatMap((r) => r.matches)]))
          .catch(() => {
            // Не узналось из-за сбоя — молчим. Сообщение о неработающем
            // узнавании не помогает делать принт и отвлекает от работы.
          })
      } catch {
        // Хранилище не ответило — работаем с тем, что в браузере. Потерять
        // возможность приложить картинку хуже, чем потерять её сохранение.
        setDropHint('Файлы не сохранились: хранилище не ответило. Работа продолжается, но перезагрузка их потеряет.')
      }
      sources.forEach((s) => cacheImage(s))
      const opaque = read.filter((d) => !d.hasAlpha)
      setDropHint(
        opaque.length === 0
          ? null
          : `Фон не вырезан: ${opaque.map((d) => d.name).join(', ')}. ` +
              'Такая картинка ляжет на изделие прямоугольником — это не поломка, ' +
              'а то, как выглядит непрозрачный файл.',
      )
      commit((c) =>
        read.reduce((acc, d, i) => {
          seq.current += 1
          const el: ImageElement = {
            id: `el-${seq.current}`,
            kind: 'image',
            name: d.name,
            src: sources[i],
            aspect: d.aspect,
            hasAlpha: d.hasAlpha,
            placement: {
              anchor: 'neck',
              dxCm: 0,
              // Бросили несколько — раскладываем лесенкой, иначе они лягут
              // друг на друга и выбрать нижний будет нечем.
              dyCm: 12 + i * 2,
              widthCm: 18,
              rotation: 0,
            },
          }
          return add(acc, el)
        }, c),
      )
    },
    [],
  )

  if (error) return <main style={S.page}>Изделие не загрузилось: {error}</main>
  if (!product || !state) return <main style={S.page}>Загружаю изделие…</main>

  const cal = product.calibration

  return (
    <main style={S.page}>
      <header style={S.head}>
        <h1 style={S.h1}>{product.display_name}</h1>
        <span style={S.code}>{product.code}</span>
        <span style={S.dim}>
          {cal.px_per_cm} px/см{cal.provisional && ' · предварительно'}
          {restored && ' · восстановлено с прошлого раза'}
        </span>
      </header>

      <div style={S.body}>
        <div>
          <div
            style={S.canvasBox}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => void onDrop(e)}
          >
            <GarmentCanvas
              state={state}
              frameSrc={frameUrl(product.code, state.code)}
              calibration={calibration}
              composition={composition}
              params={params}
              renderScale={renderScale}
              onFps={setFps}
              showZones={overlay === 'zones' || overlay === 'all'}
              showAnchors={overlay === 'anchors' || overlay === 'all'}
              onSelect={(id) => setComposition((c) => select(c, id))}
              onMove={(id, dxCm, dyCm) => setComposition((c) => place(c, id, { dxCm, dyCm }))}
              onResize={(id, widthCm) => setComposition((c) => place(c, id, { widthCm }))}
              onRotate={(id, rotation) => setComposition((c) => place(c, id, { rotation }))}
              onCommit={() => commit()}
              onCanvas={(el) => (viewCanvas.current = el)}
              images={images.current}
              key={imagesVersion}
            />
          </div>
          {composition.elements.length === 0 && (
            <p style={S.dim}>Перетащите сюда картинки — можно несколько разом.</p>
          )}
          {dropHint && <p style={S.warn}>{dropHint}</p>}
          {seen.length > 0 && <Recognised matches={seen} onClose={() => setSeen([])} />}
        </div>

        <aside style={S.panel}>
          <Group title="Состояние">
            {product.states.map((s) => (
              <button
                key={s.code}
                onClick={() => setStateCode(s.code)}
                style={s.code === state.code ? S.btnOn : S.btn}
              >
                {s.display_name}
                {s.kind === 'illustrative' && <em style={S.tag}> только показ</em>}
              </button>
            ))}
          </Group>

          <Group title="Цвет изделия">
            <div style={S.swatches}>
              {colours.map((c) => (
                <button
                  key={c.code}
                  title={`${c.name} · ${c.code}`}
                  onClick={() => {
                    setColourCode(c.code)
                    setParams((p) => ({ ...p, base: toUnit(c) }))
                  }}
                  style={{
                    ...S.swatch,
                    background: toCss(c),
                    outline: c.code === colourCode ? '2px solid #111' : '1px solid #d1d5db',
                  }}
                />
              ))}
            </div>
            <p style={S.dim}>
              {colours.find((c) => c.code === colourCode)?.name ?? '—'}
              {' · на фабрику уходит код, а не оттенок с экрана'}
            </p>
            <Slider
              label="гамма базы"
              value={params.baseGamma}
              min={0.3}
              max={1.5}
              step={0.05}
              digits={2}
              onChange={(v) => setParams((p) => ({ ...p, baseGamma: v }))}
            />
            <Slider
              label="блики"
              value={params.specAmount}
              min={0}
              max={1}
              step={0.05}
              digits={2}
              onChange={(v) => setParams((p) => ({ ...p, specAmount: v }))}
            />
          </Group>

          <Group title="Эффекты">
            <button
              onClick={() => setParams((p) => ({ ...p, effects: !p.effects }))}
              style={params.effects ? S.btnOn : S.btn}
            >
              {params.effects ? 'с эффектами' : 'без эффектов'}
            </button>
            <button
              onClick={() => setParams((p) => ({ ...p, through: !p.through }))}
              style={params.through ? S.btnOn : S.btn}
              title="Показать то, что скрыто капюшоном. По умолчанию выключено: картинка не должна врать в состоянии, в котором её открыли"
            >
              {params.through ? 'перекрытое насквозь' : 'перекрытое скрыто'}
            </button>
            <Slider
              label="смещение"
              value={params.displace}
              min={0}
              max={1}
              step={0.01}
              digits={2}
              onChange={(v) => setParams((p) => ({ ...p, displace: v }))}
            />
            <Slider
              label="затенение"
              value={params.shade}
              min={0}
              max={1}
              step={0.05}
              digits={2}
              onChange={(v) => setParams((p) => ({ ...p, shade: v }))}
            />
            <Slider
              label="гамма тени"
              value={params.shadeGamma}
              min={0.4}
              max={2.5}
              step={0.05}
              digits={2}
              onChange={(v) => setParams((p) => ({ ...p, shadeGamma: v }))}
            />
            <div style={S.row}>
              {[1, 2, 3].map((s) => (
                <button key={s} onClick={() => setRenderScale(s)} style={s === renderScale ? S.btnOn : S.btn}>
                  {s}×
                </button>
              ))}
              <button onClick={() => download(params)} style={S.btn}>
                выгрузить
              </button>
              <label style={S.btn}>
                вернуть
                <input
                  type="file"
                  accept="application/json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void upload(f).then(setParams).catch(() => undefined)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p style={S.dim}>
              отрисовка {Math.round(state.frame.width * renderScale)} px
              {fps !== null && ` · ${fps} кадр/с`}
            </p>
          </Group>

          <Group title="Что видно">
            {(['all', 'anchors', 'zones', 'none'] as Overlay[]).map((o) => (
              <button key={o} onClick={() => setOverlay(o)} style={o === overlay ? S.btnOn : S.btn}>
                {{ all: 'всё', anchors: 'ориентиры', zones: 'зоны', none: 'ничего' }[o]}
              </button>
            ))}
          </Group>

          <Group title={`Проверки (${open.length})`}>
            {open.length === 0 && composition.elements.length > 0 && (
              <p style={S.dim}>находок нет</p>
            )}
            <div style={S.list}>
              {open.map((f) => (
                <div
                  key={keyOf(f)}
                  style={f.weight === 'blocking' ? S.findingBlocking : S.findingWarning}
                >
                  <span style={S.findingText}>{f.message}</span>
                  {f.weight === 'warning' && (
                    <button
                      title="Так и задумано. Кто закрыл — появится вместе со входом платформы"
                      onClick={() => setDismissed((d) => new Set([...d, keyOf(f)]))}
                      style={S.x}
                    >
                      ✓
                    </button>
                  )}
                </div>
              ))}
            </div>
            {dismissed.size > 0 && (
              <p style={S.dim}>
                закрыто «так и задумано»: {dismissed.size} · имя закрывшего появится
                вместе со входом платформы
              </p>
            )}
          </Group>

          <Group title="На фабрику">
            <button
              onClick={downloadSheet}
              disabled={composition.elements.length === 0 || blocking(open).length > 0}
              style={S.btn}
              title={
                blocking(open).length > 0
                  ? 'Сначала исправьте блокирующие находки: такой принт не пропечатается'
                  : undefined
              }
            >
              выгрузить печатный лист
            </button>
            {composition.elements.length > 0 && (
              <p style={S.dim}>
                {describeSheet(composition).widthCm.toFixed(1)} ×{' '}
                {describeSheet(composition).heightCm.toFixed(1)} см, элементов{' '}
                {describeSheet(composition).items.length}
                {cal.provisional && ' · калибровка предварительная, числа уточнятся'}
              </p>
            )}
            <p style={S.dim}>
              лист собирается мимо смещения и света: складок в нём не бывает по
              устройству
            </p>
          </Group>

          <Group title="Показать людям">
            <button onClick={downloadSnapshot} style={S.btn}>
              сохранить картинкой
            </button>
            <p style={S.dim}>
              изделие как его увидит человек — со складками, тенью и цветом. Не
              печатный лист: тот плоский и идёт на фабрику
            </p>
          </Group>

          <Group title="Правка">
            <button
              onClick={() => {
                forget()
                commit(EMPTY)
                setRestored(false)
              }}
              style={S.btn}
            >
              очистить
            </button>
            <button onClick={history.undo} disabled={!history.canUndo} style={S.btn}>
              отменить
            </button>
            <button onClick={history.redo} disabled={!history.canRedo} style={S.btn}>
              вернуть
            </button>
            <p style={S.dim}>Ctrl+Z и Ctrl+Shift+Z. Ползунки подбора не откатываются</p>
          </Group>

          <Group title="Набор принтов">
            <div style={S.list}>
              {prints
                .slice()
                .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'probe' ? -1 : 1))
                .map((item) => (
                  <button
                    key={item.path}
                    onClick={() => addFromSet(item)}
                    title={item.answers ?? item.subject ?? item.name}
                    style={item.kind === 'probe' ? S.setProbe : S.setArtwork}
                  >
                    <span style={S.itemName}>{item.subject ?? item.name}</span>
                    {item.width_cm && <span style={S.tag}>{item.width_cm} см</span>}
                  </button>
                ))}
            </div>
            <p style={S.dim}>
              эталоны подписаны вопросом, на который отвечают; настоящие принты
              добавляются тем же способом
            </p>
          </Group>

          <Group title={`Элементы (${composition.elements.length})`}>
            <button onClick={addLabel} style={S.btn}>
              + надпись
            </button>
            {composition.elements.length === 0 && <p style={S.dim}>пусто</p>}
            <div style={S.list}>
              {composition.elements.map((el) => (
                <div
                  key={el.id}
                  onClick={() => setComposition((c) => select(c, el.id))}
                  style={el.id === composition.selectedId ? S.itemOn : S.item}
                >
                  <span style={S.itemName}>{el.name}</span>
                  {el.kind === 'image' && !el.hasAlpha && (
                    <span style={S.badge}>фон не вырезан</span>
                  )}
                  <button
                    style={S.x}
                    onClick={(e) => {
                      e.stopPropagation()
                      commit((c) => remove(c, el.id))
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Group>

          {selected?.kind === 'text' && (
            <Group title="Надпись">
              <input
                value={selected.text}
                onChange={(e) => {
                  const text = e.target.value
                  commit((c) => {
                    const next = retype(c, selected.id, text)
                    return restyle(next, selected.id, {
                      textAspect: aspectOf({ ...selected, text }),
                    })
                  })
                }}
                style={S.textInput}
              />
              <div style={S.row}>
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
                    style={{
                      ...(f.family === selected.fontFamily ? S.btnOn : S.btn),
                      fontFamily: `"${f.family}", sans-serif`,
                    }}
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
                    onClick={() =>
                      commit((comp) =>
                        restyle(comp, selected.id, { colourCode: c.code, rgb: c.rgb }),
                      )
                    }
                    style={{
                      ...S.swatch,
                      background: toCss(c),
                      outline: c.code === selected.colourCode ? '2px solid #111' : '1px solid #d1d5db',
                    }}
                  />
                ))}
              </div>
              <p style={S.dim}>
                шрифты только загруженные в систему, лицензия названа у каждого
              </p>
            </Group>
          )}

          {selected && (
            <Group title="Размещение">
              <Num
                label="от горловины вниз"
                value={selected.placement.dyCm}
                onChange={(v) => commit((c) => place(c, selected.id, { dyCm: v }))}
              />
              <Num
                label="от центра вбок"
                value={selected.placement.dxCm}
                onChange={(v) => commit((c) => place(c, selected.id, { dxCm: v }))}
              />
              <Num
                label="ширина"
                value={selected.placement.widthCm}
                onChange={(v) => commit((c) => place(c, selected.id, { widthCm: Math.max(0.5, v) }))}
              />
              <Num
                label="поворот, °"
                value={selected.placement.rotation}
                unit=""
                onChange={(v) => commit((c) => place(c, selected.id, { rotation: v }))}
              />
              <p style={S.dim}>высота {formatCm(heightCm(selected))} — следует за пропорцией</p>
              <p style={S.dim}>стрелки двигают на 1 мм, с Shift — на 1 см</p>
            </Group>
          )}
        </aside>
      </div>
    </main>
  )
}

/** Настройки подбора уходят файлом: иначе они испарятся вместе с вкладкой. */
function download(params: RenderParams) {
  const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'render-params.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Возврат подобранного. Без него выгрузка бессмысленна: подбор нужен затем,
 *  чтобы к нему вернуться, а не чтобы иметь файл. */
async function upload(file: File): Promise<RenderParams> {
  const raw = JSON.parse(await file.text()) as Partial<RenderParams>
  return {
    base: raw.base ?? DEFAULT_PARAMS.base,
    baseGamma: Number(raw.baseGamma ?? DEFAULT_PARAMS.baseGamma),
    specCut: Number(raw.specCut ?? DEFAULT_PARAMS.specCut),
    specAmount: Number(raw.specAmount ?? DEFAULT_PARAMS.specAmount),
    through: raw.through ?? DEFAULT_PARAMS.through,
    displace: Number(raw.displace ?? DEFAULT_PARAMS.displace),
    shade: Number(raw.shade ?? DEFAULT_PARAMS.shade),
    shadeGamma: Number(raw.shadeGamma ?? DEFAULT_PARAMS.shadeGamma),
    effects: raw.effects ?? DEFAULT_PARAMS.effects,
  }
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  digits,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  digits: number
  onChange: (v: number) => void
}) {
  return (
    <label style={S.slider}>
      <span style={S.numLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={S.sliderValue}>{value.toFixed(digits)}</span>
    </label>
  )
}

function Num({
  label,
  value,
  unit = ' см',
  onChange,
}: {
  label: string
  value: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label style={S.num}>
      <span style={S.numLabel}>{label}</span>
      <input
        type="number"
        step={0.1}
        value={Number(value.toFixed(1))}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.input}
      />
      <span style={S.numUnit}>{unit}</span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={S.group}>
      <h2 style={S.h2}>{title}</h2>
      <div style={S.row}>{children}</div>
    </section>
  )
}

// Стили временные и нарочно скупые: визуальный язык приедет из @platform/tokens,
// и заводить здесь свой набор цветов нельзя — он потом не выполется.
const LEVELS: Record<Match['level'], string> = {
  file: 'Этот же файл уже загружали',
  same: 'Та же картинка, файл другой',
  close: 'Похожая картинка',
}

/** Окно узнавания. Показывается ТОЛЬКО когда есть что показать. */
function Recognised({ matches, onClose }: { matches: Match[]; onClose: () => void }) {
  // Два случая разведены, потому что разные и выводы: «та же» означает дубль и
  // повод не делать второй раз, «похожая» — повод посмотреть, чем кончилось
  // прошлое.
  const file = matches.filter((m) => m.level === 'file')
  const same = matches.filter((m) => m.level === 'same')
  const close = matches.filter((m) => m.level === 'close')
  return (
    <div style={S.found}>
      <div style={S.foundHead}>
        <strong>
          {file.length + same.length > 0 ? 'Такое у нас уже было' : 'Похожее у нас уже было'}
        </strong>
        <button onClick={onClose} style={S.btn}>
          закрыть
        </button>
      </div>
      {[...file, ...same, ...close].map((m) => (
        <div key={m.digest + m.level} style={S.foundRow}>
          <img src={assetUrl(m.digest, 'thumb')} alt="" style={S.foundThumb} />
          <div>
            <div>
              {LEVELS[m.level]}: <b>{m.name}</b>
            </div>
            <div style={S.dim}>
              {m.level === 'file'
                ? 'тот же файл — совпало содержимое'
                : `совпадение ${(m.similarity * 100).toFixed(0)}%`}
            </div>
            {/* Место под итог продаж оставлено честно пустым: продаж у нас
                пока нет, и подставлять вместо них выдумку нельзя — по ней
                начнут принимать решения. */}
            <div style={S.dim}>чем кончилось: продаж по этой картинке ещё не собрано</div>
          </div>
        </div>
      ))}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'system-ui, sans-serif', padding: 16, color: '#111' },
  head: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 },
  h1: { fontSize: 18, margin: 0 },
  code: { color: '#666', fontSize: 13 },
  body: { display: 'flex', gap: 18, alignItems: 'flex-start' },
  canvasBox: { width: 620, height: 620, background: '#f3f4f6', borderRadius: 8, padding: 6 },
  panel: { minWidth: 280, maxWidth: 330 },
  group: { marginBottom: 14 },
  h2: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#666', margin: '0 0 6px' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  list: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' },
  item: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'pointer' },
  itemOn: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', cursor: 'pointer' },
  itemName: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  badge: { fontSize: 10, color: '#b45309', background: '#fef3c7', padding: '1px 5px', borderRadius: 4 },
  x: { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#9ca3af' },
  btn: { padding: '5px 10px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, cursor: 'pointer' },
  btnOn: { padding: '5px 10px', border: '1px solid #111', background: '#111', color: '#fff', borderRadius: 6, cursor: 'pointer' },
  tag: { color: '#9ca3af', fontStyle: 'normal', fontSize: 11 },
  findingBlocking: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', width: '100%' },
  findingWarning: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #fde68a', background: '#fffbeb', width: '100%' },
  findingText: { flex: 1, fontSize: 12, lineHeight: 1.35 },
  setProbe: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff', cursor: 'pointer', textAlign: 'left', width: '100%' },
  setArtwork: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' },
  textInput: { width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 6 },
  swatches: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  swatch: { width: 26, height: 26, borderRadius: 5, border: 'none', cursor: 'pointer', padding: 0 },
  slider: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginBottom: 2 },
  sliderValue: { fontSize: 11, color: '#6b7280', width: 38, textAlign: 'right' },
  num: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginBottom: 4 },
  numLabel: { flex: 1, fontSize: 12, color: '#374151' },
  numUnit: { fontSize: 12, color: '#9ca3af', width: 26 },
  input: { width: 74, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 5 },
  found: {
    marginTop: 10,
    padding: 12,
    border: '1px solid #c7d2fe',
    background: '#eef2ff',
    borderRadius: 8,
    maxWidth: 620,
    fontSize: 13,
  },
  foundHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  foundRow: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 },
  foundThumb: {
    width: 56,
    height: 56,
    objectFit: 'contain',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 6,
  },
  warn: { color: '#b45309', fontSize: 13, lineHeight: 1.4, maxWidth: 620 },
  dim: { color: '#666', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4 },
}
