import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

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
import type { FileTags, Match, Named, Tag } from '../shared/api/assets'
import {
  assetUrl,
  digestOf,
  fetchTags,
  recogniseAssets,
  uploadAssets,
  uploadCanvas,
  UploadRefused,
} from '../shared/api/assets'
import type { ReferenceMatch } from '../shared/api/references'
import { listReferences, openReference, saveReference, type Card } from '../shared/api/references'
import { readDropped } from '../shared/dropped'
import { historyKey } from '../shared/keys'
import { newElementId, onSide, sidesUsed, upgrade } from '../shared/sides'
import { buildTorso, projectRect, toSurface } from '../shared/torso'
import { editAtSize, gradeOf, graded, resetAtSize, scaleAt, setScale } from '../shared/grading'
import { forget, load, save } from '../shared/saved'
import { blocking, check, type Finding } from '../shared/checks'
import { checkZones } from '../shared/zones'
import { calibrationFor, fieldFor, fieldSize, sizesWithField } from '../shared/fields'
import { describe as describeSheet, render as renderSheet } from '../shared/sheet'
import { useHistoryState } from '../shared/useHistory'

// Стенд нанесения. Кадр изделия, на него бросают картинки, их двигают и мерят
// в сантиметрах. Складки и тень приедут следующей историей — здесь проверяется,
// что сантиметры стыкуются с кадром и что этим можно пользоваться руками.

const PRODUCT = 'B-HDY-14'

/** Сторона окна показа, пиксели. Приближение увеличивает полотно внутри
 *  него, а само окно не растёт — иначе страница разъезжается. */
const BOX = 620

/** Ширина плитки панели, пиксели. Одна на все группы. */
const TILE = 300

/** Масштаб миниатюры стороны к кадру. Кадр — около тысячи точек, миниатюра
 *  на экране — меньше сотни; четверть оставляет запас на плотный экран. */
const THUMB_SCALE = 0.25
const noop = () => undefined

// Имена сторон по-русски. Коды уходят на фабрику, имена — человеку.
const SIDE_NAMES: Record<string, string> = { front: 'перед', back: 'спина', left: 'левый бок' }
type Overlay = 'none' | 'anchors' | 'zones' | 'all'

export function Bench() {
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stateCode, setStateCode] = useState('front')
  // Размер изделия. Печатное поле идёт за ним: принт, помещающийся на 164,
  // на 98 не влезает вдвое, и узнать это надо здесь, а не на фабрике.
  const [size, setSize] = useState<number | null>(null)
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
  // Приближение показа. НЕ размер принта: приблизить показ и увеличить принт —
  // разные действия, и второе уходит на фабрику.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const panFrom = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  // Узнанное. Пусто — окна нет вовсе: окно «совпадений нет» превращает
  // подсказку в помеху, и его перестают читать вместе с полезными.
  const [seen, setSeen] = useState<Match[]>([])
  // Узнанное при сохранении собранного принта. Отдельно от seen: там
  // совпадают ФАЙЛЫ, здесь — собранные принты, и выводы разные.
  const [seenCards, setSeenCards] = useState<ReferenceMatch[]>([])
  // Сохранённые карточки. Грузятся при открытии и после каждого сохранения.
  const [cards, setCards] = useState<Card[]>([])
  // Теги файлов по имени файла. Ставятся сами при узнавании; для уже
  // лежащих — досчитываются по сохранённому вектору.
  const [tagsOf, setTagsOf] = useState<Record<string, FileTags>>({})
  const [opened, setOpened] = useState<string | null>(null)
  useEffect(() => {
    const missing = [
      ...new Set(
        composition.elements
          .filter((el) => el.kind === 'image')
          .map((el) => digestOf(el.src))
          .filter((d) => d && !(d in tagsOf)),
      ),
    ]
    if (missing.length === 0) return
    void fetchTags(missing)
      .then((got) => setTagsOf((m) => ({ ...m, ...got })))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition.elements])
  useEffect(() => {
    void listReferences().then(setCards).catch(() => setCards([]))
  }, [])
  // Закрытые предупреждения: «так и задумано». Ключ — правило плюс элемент.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const viewCanvas = useRef<HTMLCanvasElement | null>(null)
  const measurer = useRef<CanvasRenderingContext2D | null>(null)

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
      setSize(was.size ?? null)
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
  // Калибровка ВЫБРАННОГО размера: от неё зависят и показ, и проверки, и
  // перетаскивание. Одна на всех — разложенная по местам, она разошлась бы, и
  // принт на экране оказался бы не того размера, что в проверке.
  const grid = product?.size_grid ?? null
  const grade = gradeOf(grid, size)
  const calibration = useMemo(
    () => calibrationFor({ pxPerCm: product?.calibration.px_per_cm ?? 1, provisional: true }, grade),
    [product, grade],
  )
  // Работа на выбранном размере. Хранится она в базовом, а показ, проверки
  // и печатный лист смотрят на неё в сантиметрах выбранного размера.
  const sized = useMemo(() => graded(composition, grid, size), [composition, grid, size])
  /** Правка на размере — в единицах базы: иначе переключение размера тихо
   *  переписывало бы то, от чего считаются все остальные. */
  const placeSized = (c: typeof composition, id: string, patch: Parameters<typeof place>[2]) => {
    // Правка ширины не на базовом размере — исключение этого размера, а не
    // новая база: остальные размеры остаются по сетке.
    const el = c.elements.find((e) => e.id === id)
    return el ? place(c, id, editAtSize(el.placement, patch, grid, size)) : c
  }
  // Вид на ТЕКУЩУЮ сторону. Правки идут в полную композицию по id, поэтому
  // переключение стороны ничего не теряет: отбор — это взгляд, а не правка.
  const visible = useMemo(() => onSide(sized, stateCode), [sized, stateCode])
  // Миниатюры сторон идут за работой с задержкой, а не на каждом кадре
  // перетаскивания: три отрисовки сверх основной на каждое движение руки —
  // цена, а миниатюре достаточно показать, где рука остановилась.
  const [thumbWork, setThumbWork] = useState(sized)
  useEffect(() => {
    const t = setTimeout(() => setThumbWork(sized), 150)
    return () => clearTimeout(t)
  }, [sized])
  // Объём торса при калибровке выбранного размера: сантиметры ткани на
  // 98 и на 164 — разные пиксели одного и того же кадра.
  const torso = useMemo(
    () => (product?.torso ? buildTorso(product.torso, calibration.pxPerCm) : null),
    [product, calibration],
  )
  const anchorsBySide = useMemo(
    () => Object.fromEntries((product?.states ?? []).map((s) => [s.code, s.anchors])),
    [product],
  )
  // Что лежит на других сторонах. Без этого про спину забывают и сдают
  // половину работы.
  const elsewhere = useMemo(() => {
    const counts = sidesUsed(composition)
    delete counts[stateCode]
    return counts
  }, [composition, stateCode])

  // Свойства правятся у ВИДИМОГО элемента. Из полной композиции сюда попадал
  // бы выделенный на другой стороне: панель показывает одно, экран другое, и
  // правка уходит в невидимое — заметить это можно только по чужому кадру.
  // Поле выбранного размера. null — для этого размера технолог поля не дал,
  // и тогда считаем по зоне кадра, сказав об этом человеку.
  const field = useMemo(
    () => fieldFor(product?.print_fields ?? null, size ?? 0, stateCode, state?.zones?.print, calibration),
    [product, size, stateCode, state, calibration],
  )

  // Поле размера в сантиметрах ткани и его контур на кадре. С объёмом контур
  // идёт через модель, как принт: плоский прямоугольник на 164 вылезал бы за
  // торс, хотя по ткани поле на нём укладывается.
  const fieldCm = useMemo(
    () => fieldSize(product?.print_fields ?? null, size, stateCode),
    [product, size, stateCode],
  )
  const fieldOutline = useMemo(() => {
    const zone = state?.zones?.print
    const panel = stateCode === 'front' || stateCode === 'back' ? stateCode : null
    if (!torso || !panel || !fieldCm || !zone || !torso.views[stateCode]) return field
    const xs = zone.map((p) => p[0])
    const ys = zone.map((p) => p[1])
    const s = toSurface(
      torso,
      stateCode,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    )
    if (!s) return field
    const centre = { u: panel === 'front' ? s.uFront : s.uBack, h: s.h }
    return projectRect(torso, stateCode, panel, centre, fieldCm[0], fieldCm[1], 0, 12)
  }, [torso, stateCode, fieldCm, state, field])

  const selected = find(visible, visible.selectedId)

  // Сохраняем то, что закреплено. Живое перетаскивание не пишем: писать
  // десятки раз в секунду незачем, а отличить закреплённое от живого умеет
  // только тот, кто менял.
  useEffect(() => {
    if (composition.elements.length === 0) return
    save({ version: 2, stateCode, colourCode, size, composition })
  }, [composition, stateCode, colourCode, size])
  // Пороги приходят из описания изделия, а не из кода.
  const rules = product?.print_rules
  // Две группы находок, а не одна: первая считается из самого принта и верна на
  // любом изделии, вторая — из КАДРА, и без состояния её посчитать нечем.
  // Находки считаются по ОТЛОЖЕННОЙ композиции: во время перетаскивания
  // панели проверок незачем обновляться на каждый кадр, а считаются они по
  // ткани дороже, чем рисуется сам принт. Отстают на кадр-другой и догоняют,
  // как только рука остановилась.
  const checked = useDeferredValue(visible)
  const findings = [
    ...checkZones(
      checked,
      state ?? { code: '', kind: 'precise', anchors: {}, zones: {}, lines: {} },
      calibration,
      field,
      torso && state ? { torso, anchors: state.anchors, fieldCm } : null,
    ),
    ...check(
    checked,
    rules
      ? {
          minLetterCm: rules.min_letter_cm,
          warnLetterCm: rules.warn_letter_cm,
          minStrokeCm: rules.min_stroke_cm,
          maxColours: rules.max_colours,
        }
      : undefined,
    ),
  ]
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
  async function addFromSet(item: PrintItem) {
    // Печатный принт из набора — ФАЙЛОМ, тем же путём, что брошенный: в
    // хранилище, с вектором, узнаванием и тегами. Эталон стенда — сетка,
    // буквы, линии — остаётся пробой: это не принт, и в библиотеке с тегами
    // ему не место.
    if (item.kind !== 'probe') {
      const blob = await (await fetch(printUrl(item.path))).blob()
      const file = new File([blob], item.name, { type: blob.type || 'image/png' })
      await addFiles([file], item.width_cm ?? 18)
      return
    }
    if (refusedHere()) return
    const img = new Image()
    img.onload = () => {
      cacheImage(img.src)
      commit((c) =>
        add(c, {
          id: newElementId(),
          kind: 'image',
          name: item.name,
          src: img.src,
          aspect: img.naturalWidth / img.naturalHeight,
          // Эталон считается вырезанным: он нарисован кодом и прозрачность у
          // него настоящая, кроме того, который её нарочно не имеет.
          hasAlpha: item.name !== 'fon-ne-vyrezan.png',
          placement: {
            side: stateCode,
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

  /** Приблизить показ.
   *
   * Разрешение отрисовки растёт ВМЕСТЕ с приближением: иначе увеличенное
   * изображение — это увеличенные пиксели, по которым о печати судить нельзя,
   * а именно ради этого его и приближают.
   */
  function zoomTo(next: number, around?: { x: number; y: number }) {
    const z = Math.min(6, Math.max(1, Number(next.toFixed(2))))
    setZoom(z)
    setRenderScale(Math.min(3, Math.ceil(z)))
    if (z === 1) {
      setPan({ x: 0, y: 0 })
      return
    }
    // Приближение к точке под курсором, а не к центру: иначе разглядываемая
    // деталь уезжает из окна ровно в тот момент, когда её увеличили.
    setPan((p) => {
      if (!around) return clampPan(p, z)
      const k = z / zoom
      return clampPan({ x: around.x - (around.x - p.x) * k, y: around.y - (around.y - p.y) * k }, z)
    })
  }

  /** Не даёт увести изделие за край окна: уехавшую часть вернуть нечем. */
  function clampPan(p: { x: number; y: number }, z: number) {
    const limit = (BOX * (z - 1)) / 2
    return {
      x: Math.min(limit, Math.max(-limit, p.x)),
      y: Math.min(limit, Math.max(-limit, p.y)),
    }
  }

  /** Сохранить собранный принт и узнать, не собирали ли такой раньше.
   *
   * Лист кладётся в хранилище как обычная картинка: по нему считается вектор
   * «такой принт уже был», а вторая копия рядом разошлась бы с первой.
   */
  async function saveCard() {
    // Сохраняется СТОРОНА, а не изделие целиком: перед и спина печатаются
    // разными прогонами, и «такой принт уже был» — вопрос про сторону.
    if (visible.elements.length === 0) return
    const canvas = renderSheet(visible, images.current, 120)
    const sheet = await uploadCanvas(canvas, `${PRODUCT}-${stateCode}-list.png`)
    const found = await saveReference({
      name: `${PRODUCT} · ${SIDE_NAMES[stateCode] ?? stateCode} · ${colourCode}${size ? ' · ' + size : ''}`,
      sheet_digest: sheet,
      image_digests: visible.elements
        .filter((el) => el.kind === 'image')
        .map((el) => digestOf(el.src))
        .filter(Boolean),
      texts: visible.elements
        .filter((el) => el.kind === 'text')
        .map((el) => (el.kind === 'text' ? el.text : '')),
      // Работа целиком — все стороны, сантиметры базы, исключения размеров,
      // цвет. Лист и надписи выше — для узнавания; открывается карточка
      // вот этим.
      work: { version: 2, stateCode, colourCode, size, composition },
    })
    setSeenCards(found.matches)
    void listReferences().then(setCards).catch(() => undefined)
  }

  /** Открыть сохранённую карточку: работа восстанавливается как была. */
  async function openCard(card: Card) {
    const got = await openReference(card.id)
    const w = got.work as {
      stateCode?: string
      colourCode?: string
      size?: number | null
      composition?: typeof composition
    } | null
    if (!w?.composition) {
      // Карточка из тех времён, когда сохранялся только снимок для узнавания.
      // Открыть её нечем — и сказано это прямо, а не пустым изделием.
      setDropHint(`«${card.name}» сохранена до того, как карточки стали хранить работу: открыть нечего.`)
      return
    }
    const c = upgrade(w.composition)
    for (const el of c.elements) if (el.kind === 'image') cacheImage(el.src)
    if (w.stateCode) setStateCode(w.stateCode)
    if (w.colourCode) setColourCode(w.colourCode)
    setSize(w.size ?? null)
    commit(c)
    setOpened(`${card.name} · №${card.id}`)
  }

  /** Печатный лист: сборка из сантиметров, мимо шейдера, в печатном разрешении. */
  function downloadSheet() {
    if (composition.elements.length === 0) return
    // По файлу на КАЖДУЮ сторону, где что-то есть. Сведённые в один лист перед
    // и спина дают файл, который на фабрике не печатается ничем: это два
    // разных прогона.
    for (const side of Object.keys(sidesUsed(composition))) {
      downloadSheetOf(side)
    }
  }

  function downloadSheetOf(side: string) {
    const only = onSide(sized, side)
    if (only.elements.length === 0) return
    // 120 пикселей на сантиметр — около 300 точек на дюйм, обычное печатное
    // разрешение. Число названо здесь, а не спрятано: оно уйдёт на фабрику.
    const spec = describeSheet(only)
    const canvas = renderSheet(only, images.current, 120)

    // Пометка о предварительной калибровке НЕ впечатывается в лист: его
    // напечатают вместе с ней. Она уходит в имя файла и в сопроводительную
    // спецификацию — от файла они не отвяжутся, а на ткань не попадут.
    const mark = cal.provisional ? '-PREDVARITELNO' : ''
    // Размер — в имени файла: на фабрику уходит лист каждого размера, и
    // безымянный лист на 98 неотличим от листа на 164.
    const stem = PRODUCT + '-' + side + '-' + (size ?? grid?.base ?? 'baza') + mark

    const save = (blob: Blob, name: string) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    }

    const lines = [
      'Изделие: ' + PRODUCT + ', сторона: ' + (SIDE_NAMES[side] ?? side),
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
    const style = {
      text: 'ЗИМА 2026',
      fontFamily: DEFAULT_FONT.family,
      weight: 600,
      rgb: [255, 255, 255] as const,
    }
    const el: TextElement = {
      id: newElementId(),
      kind: 'text',
      name: 'надпись',
      ...style,
      colourCode: 'WHITE',
      textAspect: aspectOf(style),
      placement: { side: stateCode, anchor: 'neck', dxCm: 0, dyCm: 12, widthCm: 18, rotation: 0 },
    }
    commit((c) => add(c, el))
  }

  // Клавиши: мышкой удобно искать, но попасть в «12 см ниже горловины» ею
  // нельзя, а это основной способ работы.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const asked = historyKey(e)
      if (asked) {
        e.preventDefault()
        if (asked === 'redo') history.redo()
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

  /** По иллюстративному ракурсу размещать нельзя: силуэт на нём сокращён,
   *  и перевод сантиметров в пиксели по нему соврёт — принт уйдёт на фабрику
   *  не того размера. Показывать на нём можно, и он показывает. Проверка
   *  одна на все входы: из набора добавлять на бок тоже было можно. */
  function refusedHere(): boolean {
    if (state?.kind !== 'illustrative') return false
    setDropHint(
      'Это иллюстративный ракурс — по нему нельзя считать размер. ' +
        'Нанесите на перед или спину, здесь принт будет виден сам.',
    )
    return true
  }

  /** Файлы на изделие — один путь для всех входов: брошенные с диска и
   *  принты из набора. Отдельный путь для набора и оставлял его принты без
   *  хранилища, вектора и узнавания. */
  async function addFiles(files: File[], widthCm = 18) {
    if (files.length === 0 || refusedHere()) return
    const read = await Promise.all(files.map(readDropped))
      // Файлы уходят в хранилище: ссылка на ступень переживает перезагрузку,
      // а ссылка на blob — нет.
      let sources = read.map((d) => d.src)
      let refusal: string | null = null
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
          .then((rows) => {
            setSeen([...repeats, ...rows.flatMap((r) => r.matches)])
            setTagsOf((m) => ({
              ...m,
              ...Object.fromEntries(rows.map((r) => [r.digest, { tags: r.tags, name: r.name ?? null }])),
            }))
          })
          .catch(() => {
            // Не узналось из-за сбоя — молчим. Сообщение о неработающем
            // узнавании не помогает делать принт и отвлекает от работы.
          })
      } catch (e) {
        // Хранилище не ответило — работаем с тем, что в браузере. Потерять
        // возможность приложить картинку хуже, чем потерять её сохранение.
        // Если оно отказало с причиной — показываем причину: «не ответило»
        // про слишком большой файл увело бы человека не туда.
        const reason = e instanceof UploadRefused ? e.reason : null
        refusal =
          (reason ?? 'Файлы не сохранились: хранилище не ответило.') +
          ' Работа продолжается, но перезагрузка их потеряет.'
      }
      sources.forEach((s) => cacheImage(s))
      const opaque = read.filter((d) => !d.hasAlpha)
      const opaqueHint =
        opaque.length === 0
          ? null
          : `Фон не вырезан: ${opaque.map((d) => d.name).join(', ')}. ` +
            'Такая картинка ляжет на изделие прямоугольником — это не поломка, ' +
            'а то, как выглядит непрозрачный файл.'
      // Подсказки ставятся ОДИН раз и вместе. Раньше вторая затирала первую:
      // причина отказа хранилища пропадала сразу, потому что подсказка про
      // фон у обычной картинки пустая.
      setDropHint([refusal, opaqueHint].filter(Boolean).join(' ') || null)
      commit((c) =>
        read.reduce((acc, d, i) => {
          const el: ImageElement = {
            id: newElementId(),
            kind: 'image',
            name: d.name,
            src: sources[i],
            aspect: d.aspect,
            hasAlpha: d.hasAlpha,
            placement: {
              side: stateCode,
              anchor: 'neck',
              dxCm: 0,
              // Бросили несколько — раскладываем лесенкой, иначе они лягут
              // друг на друга и выбрать нижний будет нечем.
              dyCm: 12 + i * 2,
              widthCm,
              rotation: 0,
            },
          }
          return add(acc, el)
        }, c),
      )
  }

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      await addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')))
    },
    // Состояние ОБЯЗАНО быть в списке: сторона берётся из него, и с пустым
    // списком брошенное на спину легло бы на перед — замыкание осталось бы от
    // первой отрисовки, а ошибку было бы видно только по чужому кадру.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, stateCode],
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
            onWheel={(e) => {
              e.preventDefault()
              const box = e.currentTarget.getBoundingClientRect()
              zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), {
                x: e.clientX - box.left - box.width / 2,
                y: e.clientY - box.top - box.height / 2,
              })
            }}
            onPointerDownCapture={(e) => {
              // Тянем ФОН или средней кнопкой — двигаем вид. Тянем элемент —
              // двигаем принт. Одно движение мышью, два разных смысла, и
              // различает их то, за что взялись.
              const background = (e.target as Element).tagName.toLowerCase() === 'svg'
              if (zoom === 1 || !(background || e.button === 1)) return
              e.stopPropagation()
              panFrom.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const from = panFrom.current
              if (!from) return
              setPan(clampPan({ x: from.x + (e.clientX - from.px), y: from.y + (e.clientY - from.py) }, zoom))
            }}
            onPointerUp={() => (panFrom.current = null)}
            onPointerCancel={() => (panFrom.current = null)}
          >
            <div
              style={{
                width: BOX * zoom,
                height: BOX * zoom,
                position: 'relative',
                transform: `translate(${pan.x - (BOX * (zoom - 1)) / 2}px, ${pan.y - (BOX * (zoom - 1)) / 2}px)`,
                cursor: zoom > 1 ? 'grab' : 'default',
              }}
            >
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
              showAnchors={overlay === 'anchors' || overlay === 'all'}
              onSelect={(id) => setComposition((c) => select(c, id))}
              onMove={(id, dxCm, dyCm) => setComposition((c) => placeSized(c, id, { dxCm, dyCm }))}
              onResize={(id, widthCm) => setComposition((c) => placeSized(c, id, { widthCm }))}
              onRotate={(id, rotation) => setComposition((c) => place(c, id, { rotation }))}
              onCommit={() => commit()}
              onCanvas={(el) => (viewCanvas.current = el)}
              images={images.current}
              key={imagesVersion}
            />
            </div>
          </div>
          {visible.elements.length === 0 && (
            <p style={S.dim}>
              {state.kind === 'illustrative'
                ? 'Это иллюстративный ракурс: он показывает, но размещать по нему нельзя — силуэт сокращён, и размер в сантиметрах по нему соврёт.'
                : 'Перетащите сюда картинки — можно несколько разом.'}
            </p>
          )}
          {Object.keys(elsewhere).length > 0 && (
            <p style={S.dim}>
              На других сторонах:{' '}
              {Object.entries(elsewhere)
                .map(([code, n]) => `${SIDE_NAMES[code] ?? code} — ${n}`)
                .join(', ')}
            </p>
          )}
          {dropHint && <p style={S.warn}>{dropHint}</p>}
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

        <aside style={S.panel}>
          <Group title="Что нанести">
            {/* Первой группой, а не внизу списка элементов: ненайденная
                возможность равна отсутствующей, и владелец её не нашёл. */}
            <button onClick={addLabel} style={S.btn}>
              + надпись
            </button>
            <span style={S.dim}>картинки — перетаскиванием в окно слева</span>
          </Group>

          <Group title="Состояние">
            {/* Миниатюрами с принтом, а не словами: что лежит на спине, видно
                до нажатия, и принт, заходящий со спины на бок, виден на боку. */}
            <div style={S.thumbs}>
              {product.states.map((s) => (
                <button
                  key={s.code}
                  onClick={() => setStateCode(s.code)}
                  style={s.code === state.code ? S.thumbOn : S.thumb}
                  aria-pressed={s.code === state.code}
                  title={s.kind === 'illustrative' ? `${s.display_name} — только показ, размещать по нему нельзя` : s.display_name}
                >
                  <GarmentCanvas
                    preview
                    state={s}
                    frameSrc={frameUrl(product.code, s.code)}
                    calibration={calibration}
                    composition={thumbWork}
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
                    key={`${s.code}-${imagesVersion}`}
                  />
                  <span style={S.thumbCaption}>
                    {s.display_name}
                    {s.kind === 'illustrative' && <em style={S.tag}> · только показ</em>}
                  </span>
                </button>
              ))}
            </div>
          </Group>

          <Group title="Размер">
            <div style={S.row}>
              {product.size_set.sizes.map((s) => {
                const known = sizesWithField(product.print_fields ?? null, stateCode).includes(s)
                return (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    style={{
                      ...(s === size ? S.btnOn : S.btn),
                      // Размер без поля показан бледным, а не спрятан: спрятанный
                      // размер выглядит как несуществующий, а он существует —
                      // просто технолог поля для него не дал.
                      opacity: known ? 1 : 0.45,
                    }}
                    title={known ? '' : 'поля для этого размера нет — спросить технолога'}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            <p style={S.dim}>
              {size === null
                ? 'Размер не выбран: поле считается по зоне кадра, а она нарисована для одного размера.'
                : field
                  ? `Поле ${product.print_fields?.by_size?.[String(size)]?.[stateCode]?.join(' × ')} см` +
                    (product.print_fields?.provisional ? ' · предварительно, от технолога ещё не подтверждено' : '')
                  : 'Для этого размера поля нет — считаем по зоне кадра. Число придёт от технолога.'}
            </p>
            <p style={S.dim}>
              {/* Отрисованный размер и выбранный — разные вещи. Кадр один, и
                  растягивать его под размер нельзя: врать будет всё. */}
              Отрисован{' '}
              {product.rendered_size
                ? `${product.rendered_size}`
                : `предположительно ${product.rendered_size_assumed} — в именах кадров размера нет`}
            </p>
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
              title="Часть принта, которую закрывает капюшон. Обычно скрыта — так, как это будет на изделии. Включите, чтобы увидеть бледно, где она лежит под капюшоном"
            >
              {/* Подпись называет ЧТО видно, а не режим отрисовки: «перекрытое
                  насквозь» владелец не понял, и это было правильно. */}
              {params.through ? 'под капюшоном: видно бледно' : 'под капюшоном: скрыто'}
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
                <button key={s} onClick={() => zoomTo(s)} style={s === zoom ? S.btnOn : S.btn}>
                  {s}×
                </button>
              ))}
              <button onClick={() => zoomTo(1)} style={S.btn}>
                по размеру
              </button>
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
                {/* Габарит ЭТОЙ стороны на ВЫБРАННОМ размере: лист выгружается
                    по сторонам и по размеру, и число обеих сторон вместе на
                    базе не совпадало ни с одним файлом, который уйдёт. */}
                {SIDE_NAMES[stateCode] ?? stateCode}
                {size ? `, ${size}` : ''}: {describeSheet(visible).widthCm.toFixed(1)} ×{' '}
                {describeSheet(visible).heightCm.toFixed(1)} см, элементов{' '}
                {describeSheet(visible).items.length}
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
            <button onClick={() => void saveCard()} style={S.btn}>
              сохранить принт
            </button>
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

          <Group title={`Сохранённое (${cards.length})`}>
            {opened && <p style={S.dim}>открыта: {opened}</p>}
            {cards.length === 0 && <p style={S.dim}>пока ничего — «сохранить принт» кладёт сюда</p>}
            <div style={S.list}>
              {cards.slice(0, 12).map((c) => (
                <button
                  key={c.id}
                  onClick={() => void openCard(c)}
                  title={`${c.name} · ${new Date(c.created_at).toLocaleString('ru-RU')}`}
                  style={S.setArtwork}
                >
                  <span style={S.itemName}>
                    №{c.id} · {c.name}
                  </span>
                  <span style={S.tag}>
                    {new Date(c.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              ))}
            </div>
          </Group>

          <Group title="Набор принтов">
            <div style={S.list}>
              {prints
                .slice()
                .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'probe' ? -1 : 1))
                .map((item) => (
                  <button
                    key={item.path}
                    onClick={() => void addFromSet(item)}
                    title={[item.subject ?? item.name, item.answers].filter(Boolean).join(' — ')}
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

          <Group title={`Элементы (${visible.elements.length})`}>
            {visible.elements.length === 0 && <p style={S.dim}>пусто</p>}
            <div style={S.list}>
              {visible.elements.map((el) => (
                <div
                  key={el.id}
                  onClick={() => setComposition((c) => select(c, el.id))}
                  style={el.id === visible.selectedId ? S.itemOn : S.item}
                >
                  <span style={S.itemName} title={el.name}>
                    {el.name}
                  </span>
                  {/* Шрифт виден у КАЖДОЙ надписи, а не только у выделенной:
                      иначе, чтобы сравнить две, приходится тыкать в каждую. */}
                  {el.kind === 'text' && (
                    <span style={{ ...S.badge, fontFamily: `"${el.fontFamily}", sans-serif` }}>
                      {el.fontFamily}
                    </span>
                  )}
                  {el.kind === 'image' && !el.hasAlpha && (
                    <span style={S.badge}>фон не вырезан</span>
                  )}
                  {el.kind === 'image' && tagsOf[digestOf(el.src)]?.name && (
                    <NameChip named={tagsOf[digestOf(el.src)]!.name!} />
                  )}
                  {el.kind === 'image' && (tagsOf[digestOf(el.src)]?.tags ?? []).length > 0 && (
                    <TagChips tags={tagsOf[digestOf(el.src)]!.tags} />
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
                    <p style={sc.manual ? S.manual : S.dim}>
                      {sc.manual ? `вручную · по сетке ×${sc.byGrid.toFixed(3)} ` : `по сетке, база ${grid.base}`}
                      {sc.manual && (
                        <button
                          style={S.x}
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
              <p style={S.dim}>высота {formatCm(heightCm(selected))} — следует за пропорцией</p>
              <p style={S.dim}>стрелки двигают на 1 мм, с Shift — на 1 см</p>
            </Group>
          )}

          {selected && grid && (
            <Group title="Градация">
              {/* Таблица по всем размерам сразу: технолог сверяет её с
                  размерной сеткой, а не перебирает размеры по одному. */}
              <table style={S.gradeTable}>
                <tbody>
                  {product.size_set.sizes.map((s) => {
                    const base = composition.elements.find((e) => e.id === selected.id)
                    if (!base) return null
                    const sc = scaleAt(base.placement, grid, s)
                    return (
                      <tr key={s} style={s === size ? S.gradeRowOn : undefined}>
                        <td>{s}</td>
                        <td style={sc.manual ? S.manual : S.dim}>×{sc.k.toFixed(3)}</td>
                        <td>{(base.placement.widthCm * sc.k).toFixed(1)} см</td>
                        <td>
                          {/* Исключение видно ВМЕСТЕ с тем, что было бы по сетке:
                              иначе технолог, сверяя с сеткой, «исправит» его
                              обратно, не зная, что это нарочно. */}
                          {sc.manual && (
                            <>
                              <span style={S.manual}>вручную · по сетке ×{sc.byGrid.toFixed(3)}</span>{' '}
                              <button
                                style={S.x}
                                title="вернуть этот размер к сетке"
                                onClick={() =>
                                  commit((c) => place(c, base.id, resetAtSize(base.placement, s)))
                                }
                              >
                                ↺
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p style={S.dim}>
                база — {grid.base}
                {grid.provisional ? ' · сетка предварительная: ' + grid.method : ''}
              </p>
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
  step = 0.1,
  digits = 1,
  onChange,
}: {
  label: string
  value: number
  unit?: string
  step?: number
  digits?: number
  onChange: (v: number) => void
}) {
  return (
    <label style={S.num}>
      <span style={S.numLabel}>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(digits))}
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
const FILE_LEVELS: Record<Match['level'], string> = {
  file: 'Этот же файл уже загружали',
  same: 'Та же картинка, файл другой',
  close: 'Похожая картинка',
}

// По чему совпал собранный принт. Формулировки разные, потому что разные и
// выводы: совпавший лист — готовый дубль, совпавший рисунок при других словах —
// РАЗНАЯ работа, совпавшая надпись при другом рисунке — почти одна и та же.
const BY: Record<ReferenceMatch['by'], string> = {
  print: 'Такой принт уже собирали целиком',
  picture: 'Тот же рисунок, слова другие',
  slogan: 'Такая надпись уже была',
}

interface Row {
  readonly key: string
  readonly title: string
  readonly detail: string
  readonly thumb?: string
}

function fileRows(matches: Match[]): Row[] {
  // Сильное совпадение вверху: точное раньше похожего.
  const order: Match['level'][] = ['file', 'same', 'close']
  return [...matches]
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))
    .map((m) => ({
      key: `f-${m.digest}-${m.level}`,
      title: `${FILE_LEVELS[m.level]}: ${m.name}`,
      detail:
        m.level === 'file'
          ? 'тот же файл — совпало содержимое'
          : `совпадение ${(m.similarity * 100).toFixed(0)}%`,
      thumb: m.digest,
    }))
}

function cardDetail(m: ReferenceMatch): string {
  if (m.by === 'print') return 'совпал печатный лист — это готовый дубль'
  if (m.by === 'picture') return 'совпал рисунок, а слова другие — работа разная'
  return m.level === 'same'
    ? `надпись та же: «${m.text}»`
    : `надпись близкая: «${m.text}», совпало ${(m.similarity * 100).toFixed(0)}%`
}

function cardRows(matches: ReferenceMatch[]): Row[] {
  return matches.map((m, i) => ({
    key: `c-${m.reference_id}-${m.by}-${i}`,
    title: `${BY[m.by]}: ${m.name || 'без имени'}`,
    detail: cardDetail(m),
  }))
}

/** Окно узнавания. Показывается ТОЛЬКО когда есть что показать. */
function Recognised({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  return (
    <div style={S.found}>
      <div style={S.foundHead}>
        <strong>Такое у нас уже было</strong>
        <button onClick={onClose} style={S.btn}>
          закрыть
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={S.foundRow}>
          {r.thumb ? (
            <img src={assetUrl(r.thumb, 'thumb')} alt="" style={S.foundThumb} />
          ) : (
            <div style={S.foundThumb} />
          )}
          <div>
            <div>{r.title}</div>
            <div style={S.dim}>{r.detail}</div>
            {/* Место под итог продаж оставлено честно пустым: продаж у нас
                пока нет, и подставлять вместо них выдумку нельзя — по ней
                начнут принимать решения. */}
            <div style={S.dim}>чем кончилось: продаж по этому ещё не собрано</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Источник названия словами. Подпись из каталога и унаследованное — разная
 *  надёжность: второе перепроверяют, и различать их надо с одного взгляда. */
const NAME_SOURCES: Record<string, string> = { catalog: 'из каталога', inherited: 'как у той же картинки' }

/** Вес — доля слова среди десяти тысяч слов словаря, обычно от 0.0005 до
 *  0.05. Двумя знаками после запятой почти всё стало бы «0.00», поэтому —
 *  проценты с двумя значащими цифрами: «танк 0.50 %», «артиллерист 1.2 %». */
const weightText = (score: number) => `${(score * 100).toPrecision(2)} %`

/** Теги картинки: сильные видны сразу, остальные из двадцати — по раскрытию.
 *  Вес рядом с тегом: человек сам решает, верить ли «снег 0.31 %», — границу
 *  сильных ставит машина, судит он. */
function TagChips({ tags }: { tags: Tag[] }) {
  const [open, setOpen] = useState(false)
  const strong = tags.filter((t) => t.strong)
  const rest = tags.filter((t) => !t.strong)
  const chip = (tg: Tag, style: React.CSSProperties) => (
    <span key={tg.code} style={style} title={`вес ${tg.score.toFixed(4)} · ${tg.model}`}>
      {tg.name} <span style={S.tagScore}>{weightText(tg.score)}</span>
    </span>
  )
  return (
    <span style={S.tags}>
      {strong.map((tg) => chip(tg, S.tagChip))}
      {open && rest.map((tg) => chip(tg, S.tagWeak))}
      {rest.length > 0 && (
        <button
          style={S.tagMore}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open ? 'свернуть' : `ещё ${rest.length}`}
        </button>
      )}
    </span>
  )
}

function NameChip({ named }: { named: Named }) {
  const from = NAME_SOURCES[named.source] ?? named.source
  return (
    <span
      style={named.source === 'catalog' ? S.name : S.nameInherited}
      title={
        named.from_digest
          ? `Название взято у той же картинки, загруженной раньше (${named.from_digest.slice(0, 8)}…)`
          : 'Подпись принта в каталоге набора'
      }
    >
      {named.name} <span style={S.nameSource}>· {from}</span>
    </span>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'system-ui, sans-serif', padding: 16, color: '#111' },
  head: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 },
  h1: { fontSize: 18, margin: 0 },
  code: { color: '#666', fontSize: 13 },
  body: { display: 'flex', gap: 18, alignItems: 'flex-start' },
  canvasBox: {
    width: BOX,
    height: BOX,
    background: '#f3f4f6',
    borderRadius: 8,
    // Обрезает приближённое полотно: без этого увеличенное изделие
    // расталкивает панель и ломает раскладку страницы.
    overflow: 'hidden',
    touchAction: 'none',
  },
  panel: {
    // Плитка, а не колонка. Работа идёт короткими кругами «подвинул —
    // посмотрел — поправил», и прокрутка в каждом круге становится основным
    // занятием, пока справа пустует половина экрана.
    //
    // Сетка, а не колонки CSS: колонки рвут группу пополам, и половина
    // настроек уезжает в соседний столбец — это хуже длинной колонки, потому
    // что искать приходится в двух местах вместо одного.
    display: 'grid',
    // Ширина плитки одна на всех. 300 — самый широкий ряд управления,
    // образцы шрифтов, помещается без переноса каждого образца на свою строку,
    // а три плитки встают рядом с окном изделия на экране от 1600. Резиновая
    // ширина растягивала плитку за длинным именем, и соседние оказывались
    // разными — это и был баг.
    gridTemplateColumns: `repeat(auto-fill, ${TILE}px)`,
    alignItems: 'start',
    gap: 14,
    flex: 1,
    minWidth: 280,
    // Порядок групп не зависит от ширины: сетка заполняется по строкам, и
    // переставленные местами настройки заставляли бы искать заново при каждом
    // изменении окна.
  },
  group: { marginBottom: 14, minWidth: 0 },
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
  thumbs: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: '100%' },
  thumb: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: 4, minWidth: 0,
    border: '1px solid #d1d5db', background: '#fff', borderRadius: 6, cursor: 'pointer',
  },
  thumbOn: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: 3, minWidth: 0,
    border: '2px solid #111', background: '#f3f4f6', borderRadius: 6, cursor: 'pointer',
  },
  thumbCaption: { fontSize: 11, lineHeight: 1.2, textAlign: 'center', color: '#111' },
  findingBlocking: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', width: '100%', boxSizing: 'border-box' },
  findingWarning: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #fde68a', background: '#fffbeb', width: '100%', boxSizing: 'border-box' },
  // Находка — фраза, её читают целиком: переносится, а не обрезается. Длинное
  // имя файла без пробелов внутри фразы иначе выталкивает плашку из плитки.
  findingText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' },
  setProbe: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#eff6ff', cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box' },
  setArtwork: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box' },
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
  gradeTable: { fontSize: 12, borderCollapse: 'collapse', width: '100%' },
  gradeRowOn: { background: '#eff6ff', fontWeight: 600 },
  manual: { fontSize: 11, color: '#b45309' },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 3, width: '100%' },
  name: { fontSize: 11, fontWeight: 600, background: '#ecfdf5', color: '#065f46', padding: '1px 6px', borderRadius: 4 },
  nameInherited: { fontSize: 11, fontWeight: 600, background: '#fffbeb', color: '#92400e', padding: '1px 6px', borderRadius: 4 },
  nameSource: { fontWeight: 400, opacity: 0.8 },
  tagChip: { fontSize: 10, background: '#eef2ff', color: '#3730a3', padding: '1px 5px', borderRadius: 4 },
  tagScore: { color: '#818cf8' },
  tagWeak: { fontSize: 10, background: '#f5f5f5', color: '#6b7280', padding: '1px 5px', borderRadius: 4 },
  tagMore: { fontSize: 10, border: 'none', background: 'none', color: '#4f46e5', cursor: 'pointer', padding: '1px 3px' },
  warn: { color: '#b45309', fontSize: 13, lineHeight: 1.4, maxWidth: 620 },
  dim: { color: '#666', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4 },
}
