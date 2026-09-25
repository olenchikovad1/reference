import { Modal, TextInput, buttonClass } from '@platform/ui'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom'

import { GarmentCanvas } from '../candidates/GarmentCanvas'
import { WorkFrame } from '../candidates/WorkFrame'
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
import type { FileTags, Found, Match, Named, Tag } from '../shared/api/assets'
import {
  assetUrl,
  digestOf,
  fetchTags,
  recogniseAssets,
  searchAssets,
  uploadAssets,
  uploadCanvas,
  UploadRefused,
} from '../shared/api/assets'
import type { ReferenceMatch } from '../shared/api/references'
import {
  openReference,
  openVersion,
  saveReference,
  saveVersion,
  type ReferenceFull,
  type Saved,
  type VersionBody,
} from '../shared/api/references'
import { CODE } from '../app/shell'
import { useCan } from '../shared/api/platform'
import { readDropped } from '../shared/dropped'
import { windowKey } from '../shared/keys'
import { moveToSide, newElementId, onSide, otherSide, sidesUsed, upgrade } from '../shared/sides'
import { useFrameAlpha } from '../shared/frameAlpha'
import { buildTorso, projectRect, toSurface } from '../shared/torso'
import { editAtSize, gradeOf, graded, resetAtSize, scaleAt, setScale } from '../shared/grading'
import { forget, forgetDraft, load, loadDraft, save, type SavedState } from '../shared/saved'
import { neighbour, workKey } from '../shared/versions'
import { blocking, check, type Finding } from '../shared/checks'
import { checkZones } from '../shared/zones'
import { calibrationFor, fieldFor, fieldSize, sizesWithField } from '../shared/fields'
import { describe as describeSheet, render as renderSheet } from '../shared/sheet'
import { useHistoryState } from '../shared/useHistory'

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

const PRODUCT = 'B-HDY-14'

/** Масштаб миниатюры стороны к кадру. Кадр — около тысячи точек, миниатюра
 *  на экране — меньше сотни; четверть оставляет запас на плотный экран. */
const THUMB_SCALE = 0.25
const noop = () => undefined

// Имена сторон по-русски. Коды уходят на фабрику, имена — человеку.
const SIDE_NAMES: Record<string, string> = { front: 'перед', back: 'спина', left: 'левый бок' }
type Overlay = 'none' | 'anchors' | 'zones' | 'all'

/** Шпаргалка «?»: всё, что окно умеет без мыши. */
const KEYS: [string, string][] = [
  ['Tab / Shift+Tab', 'по объектам на холсте'],
  ['← → ↑ ↓', 'сдвинуть выбранное на 1 мм, с Shift — на 1 см'],
  ['Delete', 'убрать выбранное'],
  ['+ / −', 'приблизить, отдалить'],
  ['0', 'вписать изделие в окно'],
  ['1 / 2 / 3', 'перед, спина, бок'],
  ['A / D', 'история: раньше, позже'],
  ['Ctrl+Z / Ctrl+Y', 'отменить, вернуть'],
  ['Ctrl+S', 'сохранить новой версией'],
  ['Ctrl+Shift+S', 'сохранить как новый референс'],
  ['Esc', 'снять выбор; второй раз — закрыть окно'],
  ['?', 'эта шпаргалка'],
]

export function WorkWindow() {
  // Номер референса из адреса окна; new — новый (цветомодель — в ?colour_model).
  const { ref = 'new' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
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
  // Цвет из ячейки дропа главнее восстановленной прошлой работы: человек
  // пришёл рисовать именно на этой цветомодели.
  const colourFromDrop = new URLSearchParams(window.location.search).get('colour')
  const [colourCode, setColourCode] = useState(colourFromDrop ?? 'WHITE')
  // Цветомодель из ячейки дропа (US-0489): примерка открывается в её цвете и
  // запоминает её при сохранении. Нет — референс пока без цветомодели.
  const [colourModelId, setColourModelId] = useState<number | null>(() => {
    const v = new URLSearchParams(window.location.search).get('colour_model')
    return v ? Number(v) : null
  })
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
  // Нажатие на холст: протянули — сдвиг вида, не протянули — щелчок (по
  // изделию — его панель, мимо — всё закрыть).
  const press = useRef<{
    x: number
    y: number
    px: number
    py: number
    moved: boolean
    svg: SVGSVGElement | null
  } | null>(null)
  // Сторона квадрата показа: всё, что оставили холсту полоса и панель.
  const [box, setBox] = useState(620)
  const area = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  // Выбрано изделие (не принт): панель его цвета, размера и показа.
  const [garmentPicked, setGarmentPicked] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // Узнанное. Пусто — окна нет вовсе: окно «совпадений нет» превращает
  // подсказку в помеху, и его перестают читать вместе с полезными.
  const [seen, setSeen] = useState<Match[]>([])
  // Узнанное при сохранении собранного принта. Отдельно от seen: там
  // совпадают ФАЙЛЫ, здесь — собранные принты, и выводы разные.
  const [seenCards, setSeenCards] = useState<ReferenceMatch[]>([])
  // Сохранённые карточки. Грузятся при открытии и после каждого сохранения.
  // Нет права записи на «Референсах» — кнопки сохранения нет вовсе, а не
  // есть и отказывает; сервис и сам ответит «нет такого пути» (US-0487).
  const canSave = useCan(CODE, 'references', 'write')
  // Поиск по смыслу (US-0480). null — ещё не искали: тогда показывается
  // подсказка, а не «ничего не нашлось», которого ещё не было.
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  // Теги файлов по имени файла. Ставятся сами при узнавании; для уже
  // лежащих — досчитываются по сохранённому вектору.
  const [tagsOf, setTagsOf] = useState<Record<string, FileTags>>({})
  // Открытый референс и версия на экране (US-0490). null — работа ещё не
  // сохранялась ни разу: «Сохранить» заведёт новый референс.
  const [current, setCurrent] = useState<ReferenceFull | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  // Отпечаток открытой версии, с ним сравнивается экран. null — сравнивать не
  // с чем: несохранённое — всё, что есть на холсте.
  const [baseline, setBaseline] = useState<string | null>(null)
  // Вопрос «сохранить, не сохранять, остаться» и что сделать после ответа.
  const [leaving, setLeaving] = useState<{ then: () => void } | null>(null)
  // Вопрос «восстановить несохранённое?»: черновик и референс, к которому он.
  const [draftOffer, setDraftOffer] = useState<{ draft: SavedState; card: ReferenceFull; at: number } | null>(null)
  const [saving, setSaving] = useState(false)
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
  // Закрытые предупреждения: «так и задумано». Ключ — правило плюс элемент.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const viewCanvas = useRef<HTMLCanvasElement | null>(null)
  // Холсты миниатюр по сторонам: с них снимаются виды для витрины при
  // сохранении — они уже нарисованы, второй раз рисовать изделие незачем.
  const thumbCanvases = useRef<Record<string, HTMLCanvasElement | null>>({})
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
    const asked = Number(ref)
    if (asked) {
      // Референс из адреса окна. Несохранённое с прошлого раза предлагается
      // восстановить, а не подменяет сохранённое молча.
      void openCard(asked)
    } else if (was && !was.referenceId) {
      // Новый референс — возвращается только несохранённая ни разу работа;
      // черновики референсов лежат под своими номерами и ждут их открытия.
      setStateCode(was.stateCode)
      if (!colourFromDrop) setColourCode(was.colourCode)
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
  // Опущенный капюшон на выбранном размере: его длина растёт медленнее груди,
  // а кадр показывает любой размер одним рисунком — зона на кадре меняется во
  // столько раз, во сколько капюшон вырос относительно изделия (US-0519).
  const hoodLen = product?.hood_down?.length_cm_by_size
  const hoodBase = hoodLen?.[String(grid?.base ?? 134)]
  const hoodNow = hoodLen && size !== null ? hoodLen[String(size)] : undefined
  const hoodDownScale = hoodBase && hoodNow ? hoodNow / hoodBase / grade : 1
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
    save({ version: 2, stateCode, colourCode, size, composition, referenceId: current?.id ?? null, number: viewing })
  }, [composition, stateCode, colourCode, size, current, viewing])

  // Несохранённое — отличие экрана от открытой версии; у несохранённой ни разу
  // работы — всё, что на холсте.
  const nowKey = workKey({ colourCode, composition })
  const dirty = baseline === null ? composition.elements.length > 0 : nowKey !== baseline

  // Закрыть вкладку с правками — вопрос браузера «уйти или остаться»; своих
  // кнопок в нём браузер не даёт, поэтому «сохранить» там нет, но черновик
  // остаётся и при следующем открытии предлагается восстановить.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Уход на другую страницу приложения с правками — тот же вопрос из трёх.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  // По состоянию, а не по самому blocker: объект новый на каждой отрисовке, и
  // зависимость от него ставила бы вопрос заново бесконечно.
  const blocked = blocker.state === 'blocked'
  useEffect(() => {
    if (blocked) setLeaving({ then: () => blocker.proceed?.() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked])
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
      hoodDownScale,
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
    const limit = (box * (z - 1)) / 2
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
  async function versionBody(): Promise<VersionBody | null> {
    // Сохраняется СТОРОНА, а не изделие целиком: перед и спина печатаются
    // разными прогонами, и «такой принт уже был» — вопрос про сторону.
    if (visible.elements.length === 0) return null
    const canvas = renderSheet(visible, images.current, 120)
    const sheet = await uploadCanvas(canvas, `${PRODUCT}-${stateCode}-list.png`)
    return {
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
      // цвет. Лист и надписи выше — для узнавания; открывается версия
      // вот этим.
      work: { version: 2, stateCode, colourCode, size, composition },
    }
  }

  /** «Сохранить» (Ctrl+S): новая версия открытого референса, а если его ещё
   *  нет — новый референс. Открытая старая версия ложится поверх последней,
   *  а не на своё место. false — не сохранилось, и сказано почему. */
  async function saveCard(): Promise<boolean> {
    return keep(async (body) =>
      current ? saveVersion(current.id, body) : saveReference({ ...body, colour_model_id: colourModelId }),
    )
  }

  /** «Сохранить как» (Ctrl+Shift+S): новый референс, первая версия — то, что
   *  на экране; у нового записано, от какой версии он пошёл. */
  async function saveCardAs(): Promise<boolean> {
    return keep(async (body) =>
      saveReference({
        ...body,
        colour_model_id: current?.colour_model_id ?? colourModelId,
        forked_from: current && viewing ? { reference_id: current.id, number: viewing } : null,
      }),
    )
  }

  async function keep(send: (body: VersionBody) => Promise<Saved>): Promise<boolean> {
    if (saving) return false
    setSaving(true)
    try {
      const body = await versionBody()
      if (!body) return false
      const saved = await send({ ...body, views: await snapshotSides() })
      const card = await openReference(saved.id)
      // Правки легли в версию — черновик больше не предлагать; при «сохранить
      // как» правки ушли в новый референс, и прежнему они тоже не черновик.
      if (current) forgetDraft(current.id)
      forgetDraft(saved.id)
      setCurrent(card)
      setViewing(saved.number)
      setBaseline(nowKey)
      setRestored(false)
      setSeenCards(saved.matches)
      return true
    } catch (e) {
      // Работа не теряется: она на экране и в черновике, повторить — то же
      // сочетание клавиш.
      setDropHint(`Не сохранилось: ${e instanceof Error ? e.message : String(e)} — повторите Ctrl+S.`)
      return false
    } finally {
      setSaving(false)
    }
  }

  /** Снимки переда и спины для витрины (US-0491) — с миниатюр сторон.
   *  Миниатюры идут за работой с задержкой; если последняя правка до них ещё
   *  не дошла — ждём её, иначе на витрине окажется предпоследний вид. Снимок
   *  не сохранился — версия всё равно сохраняется, витрина покажет имя. */
  async function snapshotSides(): Promise<Record<string, string>> {
    if (thumbWork !== sized) await new Promise((r) => setTimeout(r, 300))
    const out: Record<string, string> = {}
    for (const code of ['front', 'back']) {
      const canvas = thumbCanvases.current[code]
      if (!canvas) continue
      try {
        out[code] = await uploadCanvas(canvas, `${PRODUCT}-${code}-view.png`)
      } catch {
        // см. выше: без снимка — не повод терять версию
      }
    }
    return out
  }

  /** Сделать `then`, а при несохранённом сначала спросить: сохранить, не
   *  сохранять или остаться. */
  function askLeave(then: () => void) {
    if (dirty) setLeaving({ then })
    else then()
  }

  /** Листать историю: соседняя версия открывается целиком. */
  function step(towards: 'older' | 'newer') {
    if (!current || viewing === null) return
    const n = neighbour(
      current.versions.map((v) => v.number),
      viewing,
      towards,
    )
    if (n !== null) goTo(n)
  }

  /** Открыть версию номер n — при несохранённом сначала спросить. */
  function goTo(n: number) {
    if (!current) return
    const card = current
    askLeave(() => {
      void openVersion(card.id, n)
        .then((v) => showVersion(card, n, v.work))
        .catch((e: Error) => setDropHint(`Версия №${n} не открылась: ${e.message}`))
    })
  }

  /** Показать версию референса как сохранили: стороны, цвет, размер. */
  function showVersion(card: ReferenceFull, number: number, work: unknown): boolean {
    const w = work as {
      stateCode?: string
      colourCode?: string
      size?: number | null
      composition?: typeof composition
    } | null
    if (!w?.composition) {
      // Карточка из тех времён, когда сохранялся только снимок для узнавания.
      // Открыть её нечем — и сказано это прямо, а не пустым изделием.
      setDropHint(`«${card.name}» сохранена до того, как карточки стали хранить работу: открыть нечего.`)
      return false
    }
    const c = upgrade(w.composition)
    for (const el of c.elements) if (el.kind === 'image') cacheImage(el.src)
    if (w.stateCode) setStateCode(w.stateCode)
    const colour = w.colourCode ?? colourCode
    setColourCode(colour)
    setSize(w.size ?? null)
    // Открытая версия — без выбранного: панель появляется по нажатию, а не
    // потому, что при сохранении что-то было выделено.
    commit({ ...c, selectedId: null })
    setCurrent(card)
    setViewing(number)
    setColourModelId(card.colour_model_id)
    setBaseline(workKey({ colourCode: colour, composition: c }))
    setRestored(false)
    return true
  }

  /** Открыть референс — последнюю версию или `at`. Остались правки с прошлого
   *  раза — сначала вопрос, восстановить ли их. */
  async function openCard(id: number, at?: number) {
    try {
      const card = await openReference(id)
      const number = at && card.versions.some((v) => v.number === at) ? at : card.number
      const work = number === card.number ? card.work : (await openVersion(id, number)).work
      const draft = loadDraft(id)
      // Черновик сравнивается с той версией, поверх которой правили, а не с
      // последней: открыть старую версию и не тронуть её — не правка.
      const baseNumber = draft?.number && card.versions.some((v) => v.number === draft.number) ? draft.number : number
      const base = baseNumber === number ? work : (await openVersion(id, baseNumber)).work
      const b = base as { colourCode?: string; composition?: typeof composition } | null
      const differs =
        draft !== null &&
        (!b?.composition ||
          workKey(draft) !== workKey({ colourCode: b.colourCode ?? 'WHITE', composition: upgrade(b.composition) }))
      if (differs) {
        setDraftOffer({ draft, card, at: baseNumber })
        return
      }
      showVersion(card, number, work)
    } catch (e) {
      setDropHint(`Референс №${id} не открылся: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** «Восстановить»: на экране черновик, сравнивается он с версией, поверх
   *  которой правили, — значит, виден как несохранённый. */
  async function restoreDraft(offer: { draft: SavedState; card: ReferenceFull; at: number }) {
    setDraftOffer(null)
    const d = offer.draft
    const base = offer.at === offer.card.number ? offer.card.work : (await openVersion(offer.card.id, offer.at)).work
    const b = base as { colourCode?: string; composition?: typeof composition } | null
    for (const el of d.composition.elements) if (el.kind === 'image') cacheImage(el.src)
    setStateCode(d.stateCode)
    setColourCode(d.colourCode)
    setSize(d.size ?? null)
    commit(d.composition)
    setCurrent(offer.card)
    setViewing(offer.at)
    setColourModelId(offer.card.colour_model_id)
    setBaseline(
      b?.composition ? workKey({ colourCode: b.colourCode ?? 'WHITE', composition: upgrade(b.composition) }) : null,
    )
    setRestored(true)
  }

  /** «Не восстанавливать»: правки забыты, открыта сохранённая версия. */
  async function dropDraft(offer: { draft: SavedState; card: ReferenceFull; at: number }) {
    setDraftOffer(null)
    forgetDraft(offer.card.id)
    const work = offer.at === offer.card.number ? offer.card.work : (await openVersion(offer.card.id, offer.at)).work
    showVersion(offer.card, offer.at, work)
  }

  /** Открыть сохранённую карточку: работа восстанавливается как была. */
  async function runSearch() {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    try {
      setFound(await searchAssets(q))
    } catch (e) {
      // Запрос не теряется: поле не очищается, повторить — та же кнопка.
      setSearchError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
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

  /** Закрыть окно — туда, откуда открыли: шагом назад по истории, чтобы
   *  «назад» после закрытия не открывало окно снова. Открыли прямой ссылкой —
   *  на витрину. С несохранённым уход задержит вопрос. */
  function close() {
    if (location.key !== 'default') navigate(-1)
    else navigate('/references', { replace: true })
  }

  /** «Перенести на спину» («на перед»): тот же размер и высота, вид идёт
   *  следом за принтом — проверки сразу по зонам новой стороны. */
  function moveSelected(to: string) {
    if (!selected) return
    const anchors = Object.keys(product?.states.find((s) => s.code === to)?.anchors ?? {})
    const id = selected.id
    commit((c) => select(moveToSide(c, id, to, anchors), id))
    setStateCode(to)
  }

  // Клавиши окна — одной таблицей (shared/keys.ts). Обработчик ставится один
  // раз и берёт свежее состояние из ref: иначе Ctrl+S сохранял бы то, что было
  // на экране при подписке.
  const keyAction = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keyAction.current = (e: KeyboardEvent) => {
    // Открыт вопрос «сохранить?» или «восстановить?» — клавиши у него.
    if (leaving || draftOffer) return
    const target = e.target as HTMLElement | null
    const typing =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    const a = windowKey(e, typing)
    if (!a) return
    if (helpOpen) {
      if (a.kind === 'escape' || a.kind === 'help') setHelpOpen(false)
      return
    }
    const selectedId = composition.selectedId
    switch (a.kind) {
      case 'undo':
        e.preventDefault()
        history.undo()
        return
      case 'redo':
        e.preventDefault()
        history.redo()
        return
      case 'save':
      case 'save-as':
        e.preventDefault()
        if (canSave) void (a.kind === 'save' ? saveCard() : saveCardAs())
        return
      case 'older':
      case 'newer':
        e.preventDefault()
        step(a.kind)
        return
      case 'help':
        e.preventDefault()
        setHelpOpen(true)
        return
      case 'escape':
        e.preventDefault()
        // Первый Esc снимает выбор (или уходит из поля), второй закрывает окно.
        if (typing) {
          target?.blur()
          area.current?.focus()
        } else if (libraryOpen) setLibraryOpen(false)
        else if (selectedId || garmentPicked) {
          setComposition((c) => select(c, null))
          setGarmentPicked(false)
        } else close()
        return
      case 'view': {
        const s = product?.states[a.index]
        if (!s) return
        e.preventDefault()
        setStateCode(s.code)
        return
      }
      case 'zoom':
        e.preventDefault()
        zoomTo(a.by === 'fit' ? 1 : zoom * (a.by === 'in' ? 1.25 : 1 / 1.25))
        return
      case 'nudge':
        if (!selectedId) return
        e.preventDefault()
        commit((c) => nudge(c, selectedId, a.dxCm, a.dyCm))
        return
      case 'remove':
        if (!selectedId) return
        e.preventDefault()
        commit((c) => remove(c, selectedId))
        return
      case 'next': {
        // Tab ходит по объектам, пока фокус на холсте; с последнего — дальше
        // по окну, как обычно, иначе из холста клавиатурой не выйти.
        if (document.activeElement !== area.current) return
        const ids = visible.elements.map((el) => el.id)
        const at = ids.indexOf(visible.selectedId ?? '')
        const next = at < 0 ? (a.back ? ids.length - 1 : 0) : at + (a.back ? -1 : 1)
        if (next < 0 || next >= ids.length) return
        e.preventDefault()
        setComposition((c) => select(c, ids[next]))
        return
      }
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyAction.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Колесо над изделием — приближение к точке под курсором. Подписка своя, не
  // через React: его обработчик колеса пассивный, и отменить прокрутку из
  // него нельзя. Над панелями колесо листает панели.
  const wheelZoom = useRef<(k: number, around: { x: number; y: number }) => void>(() => undefined)
  wheelZoom.current = (k, around) => zoomTo(zoom * k, around)
  const ready = !!product && !!state
  useEffect(() => {
    const el = area.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const onStage = (e.target as Element).closest('[data-stage]')
      if (!onStage) return
      e.preventDefault()
      const r = onStage.getBoundingClientRect()
      wheelZoom.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, {
        x: e.clientX - r.left - r.width / 2,
        y: e.clientY - r.top - r.height / 2,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ready])

  // Квадрат показа — по месту, которое осталось холсту.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBox(Math.max(240, Math.floor(Math.min(width, height) - 24)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  // Холст получает фокус при открытии: клавиши работают сразу, без щелчка.
  useEffect(() => {
    if (ready) area.current?.focus({ preventScroll: true })
  }, [ready])

  // Выбрали принт — панель изделия уступает ему место.
  useEffect(() => {
    if (composition.selectedId) setGarmentPicked(false)
  }, [composition.selectedId])

  // Цвет изделия виден на холсте: база шейдера следует за кодом цвета, в том
  // числе пришедшим из ячейки дропа или из открытой версии.
  useEffect(() => {
    const c = colours.find((x) => x.code === colourCode)
    if (c) setParams((p) => ({ ...p, base: toUnit(c) }))
  }, [colours, colourCode])

  // Сохранили новый — адрес окна становится адресом референса: ссылку можно
  // отдать, а «назад» по-прежнему ведёт на витрину.
  useEffect(() => {
    if (current && ref !== String(current.id)) navigate(`/references/${current.id}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  // Другой референс по ссылке изнутри окна (поиск, узнанное) — открыть его.
  useEffect(() => {
    const id = Number(ref)
    if (id && current && id !== current.id) void openCard(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])

  const onGarment = useFrameAlpha(product && state ? frameUrl(product.code, state.code) : null)

  function onAreaDown(e: React.PointerEvent<HTMLDivElement>) {
    const t = e.target as Element
    const onStage = !!t.closest('[data-stage]')
    if (onStage) area.current?.focus({ preventScroll: true })
    // Тянем ФОН или средней кнопкой — двигаем вид. Тянем принт — двигаем
    // принт: различает то, за что взялись.
    const background = onStage && t.tagName.toLowerCase() === 'svg'
    if (!(background || (onStage && e.button === 1))) return
    press.current = {
      x: pan.x,
      y: pan.y,
      px: e.clientX,
      py: e.clientY,
      moved: false,
      svg: background ? (t as SVGSVGElement) : null,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onAreaMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.px
    const dy = e.clientY - p.py
    if (!p.moved && Math.hypot(dx, dy) < 4) return
    p.moved = true
    if (zoom > 1) setPan(clampPan({ x: p.x + dx, y: p.y + dy }, zoom))
  }

  function onAreaUp(e: React.PointerEvent<HTMLDivElement>) {
    const p = press.current
    press.current = null
    if (!p || p.moved || !p.svg) return
    // Щелчок без протяжки: по изделию — его панель, мимо — всё закрыто.
    const m = p.svg.getScreenCTM()
    if (!m) return
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    setGarmentPicked(onGarment(at.x, at.y))
  }

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
      <WorkFrame label="рабочее окно" bar={closeOnly}>
        <p className="p-6">Изделие не загрузилось: {error}. Закройте окно и откройте референс ещё раз.</p>
      </WorkFrame>
    )
  if (!product || !state)
    return (
      <WorkFrame label="рабочее окно" bar={closeOnly}>
        <p className="p-6 text-muted-foreground">Загружаю изделие…</p>
      </WorkFrame>
    )

  const cal = product.calibration
  const title = current ? `№${current.id} · ${current.name}` : `${product.display_name} · новый референс`
  const target = selected ? otherSide(selected.placement.side ?? 'front') : null
  const panel: 'element' | 'garment' | null = selected ? 'element' : garmentPicked ? 'garment' : null
  const small = (tone: 'neutral' | 'accent' | 'danger' = 'neutral') =>
    buttonClass({ tone, variant: tone === 'accent' ? 'solid' : 'outline', small: true })
  const on = (active: boolean) => buttonClass({ tone: active ? 'accent' : 'neutral', variant: active ? 'soft' : 'outline', small: true })

  const bar = (
    <>
      <h1 className="truncate text-sm font-semibold" title={title}>
        {title}
      </h1>
      <span className="truncate text-xs text-muted-foreground">
        {current ? `версия ${viewing} из ${current.versions.length}` : 'ещё не сохранён'}
        {current?.forked_from &&
          ` · пошёл от №${current.forked_from.reference_id}, версия ${current.forked_from.number}`}
        {restored && ' · восстановлено с прошлого раза'}
      </span>
      {dirty && (
        <span role="status" className="shrink-0 text-xs text-warning">
          ● не сохранено
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
      <button className={small()} onClick={() => setHelpOpen(true)} title="Клавиши окна — ?" aria-label="шпаргалка по клавишам">
        ?
      </button>
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

  const elementPanel = selected && (
    <>
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate" title={selected.name}>
          {selected.kind === 'text' ? 'Надпись' : selected.name}
        </strong>
        <button className={small()} onClick={() => setComposition((c) => select(c, null))} aria-label="снять выбор">
          ×
        </button>
      </div>
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
        <Section title="Градация">
          {/* Таблица по всем размерам сразу: технолог сверяет её с размерной
              сеткой, а не перебирает размеры по одному. */}
          <table className="w-full text-xs">
            <tbody>
              {product.size_set.sizes.map((s) => {
                const base = composition.elements.find((e) => e.id === selected.id)
                if (!base) return null
                const sc = scaleAt(base.placement, grid, s)
                return (
                  <tr key={s} className={s === size ? 'bg-primary-soft' : undefined}>
                    <td>{s}</td>
                    <td className={sc.manual ? 'text-warning' : 'text-muted-foreground'}>×{sc.k.toFixed(3)}</td>
                    <td>{(base.placement.widthCm * sc.k).toFixed(1)} см</td>
                    <td>
                      {/* Исключение видно ВМЕСТЕ с тем, что было бы по сетке:
                          иначе технолог, сверяя с сеткой, «исправит» его обратно. */}
                      {sc.manual && (
                        <button
                          className="text-muted-foreground"
                          title={`вручную · по сетке ×${sc.byGrid.toFixed(3)} — вернуть к сетке`}
                          onClick={() => commit((c) => place(c, base.id, resetAtSize(base.placement, s)))}
                        >
                          ↺
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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

  const garmentPanel = (
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

  return (
    <>
      <WorkFrame label={`рабочее окно: ${title}`} bar={bar}>
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
            // Панель настроек открыта — изделие отодвигается от неё, а не прячется под ней.
            style={{ right: panel ? 344 : 0 }}
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
                  key={imagesVersion}
                />
              </div>
            </div>
          </div>

          {/* Что нанести — первым, слева сверху: ненайденная возможность равна отсутствующей. */}
          <div className="absolute left-3 top-3 flex gap-2">
            <button className={small()} onClick={addLabel}>
              + надпись
            </button>
            <button className={on(libraryOpen)} aria-expanded={libraryOpen} onClick={() => setLibraryOpen((v) => !v)}>
              + принт
            </button>
          </div>
          {libraryOpen && (
            <div className="pf-card absolute bottom-3 left-3 top-14 w-72 overflow-y-auto border border-line p-3 text-sm">
              <p className="mb-2 text-xs text-muted-foreground">картинку можно и просто перетащить с диска на изделие</p>
              <Section title="Поиск по смыслу">
                <div className="flex gap-1">
                  <TextInput
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch()
                    }}
                    placeholder="снег, вертолёт, мишка…"
                    aria-label="слово для поиска по картинкам"
                  />
                  <button onClick={() => void runSearch()} disabled={searching || !query.trim()} className={small()}>
                    {searching ? 'ищу…' : 'найти'}
                  </button>
                </div>
                {searchError && (
                  <p className="text-xs text-muted-foreground">
                    {searchError} — нажмите «найти» ещё раз; если повторится, стенд сервиса не поднят
                  </p>
                )}
                {found?.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    ничего не нашлось — назовите предмет, а не настроение: «мяч», а не «весело»
                  </p>
                )}
                {found?.map((f) => (
                  <div key={f.digest} className="flex items-center gap-2" title={`похожесть ${f.similarity}`}>
                    <img src={assetUrl(f.digest, 'thumb')} alt="" width={32} height={32} className="object-contain" />
                    <span className="flex-1 truncate text-xs">{f.name}</span>
                    <span className="text-xs text-muted-foreground">вес {f.weight.toFixed(1)}</span>
                    {f.references.map((r) => (
                      <button key={r.id} onClick={() => navigate(`/references/${r.id}`)} className={small()} title={r.name}>
                        №{r.id}
                      </button>
                    ))}
                  </div>
                ))}
              </Section>
              <Section title="Набор принтов">
                <div className="flex flex-col gap-1">
                  {prints
                    .slice()
                    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'probe' ? -1 : 1))
                    .map((item) => (
                      <button
                        key={item.path}
                        onClick={() => void addFromSet(item)}
                        title={[item.subject ?? item.name, item.answers].filter(Boolean).join(' — ')}
                        className="flex items-center gap-2 rounded border border-line px-2 py-1 text-left text-xs hover:bg-hover"
                      >
                        <span className="flex-1 truncate">{item.subject ?? item.name}</span>
                        {item.kind === 'probe' && <span className="text-muted-foreground">эталон</span>}
                        {item.width_cm && <span className="text-muted-foreground">{item.width_cm} см</span>}
                      </button>
                    ))}
                </div>
              </Section>
            </div>
          )}

          {/* Виды — иконками изделия с принтом: что лежит на спине, видно до нажатия. */}
          <div className="absolute right-3 top-3 flex gap-2" aria-label="виды изделия">
            {product.states.map((s, i) => (
              <button
                key={s.code}
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
                  key={`${s.code}-${imagesVersion}`}
                />
                <span className="absolute left-1 top-0 text-[10px] text-muted-foreground">{i + 1}</span>
              </button>
            ))}
          </div>

          {panel && (
            <div
              className="pf-card absolute bottom-3 right-3 top-[92px] w-80 overflow-y-auto border border-line p-3 text-sm"
              aria-label={panel === 'element' ? 'настройки выбранного' : 'настройки изделия'}
            >
              {panel === 'element' ? elementPanel : garmentPanel}
            </div>
          )}

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
          <Section title={`На изделии · ${SIDE_NAMES[stateCode] ?? stateCode}`}>
            {visible.elements.length === 0 && <p className="text-xs text-muted-foreground">на этой стороне пусто</p>}
            <div className="flex flex-col gap-1">
              {visible.elements.map((el) => (
                <button
                  key={el.id}
                  onClick={() => setComposition((c) => select(c, el.id))}
                  aria-pressed={el.id === visible.selectedId}
                  className={`flex flex-wrap items-center gap-1 rounded border px-2 py-1 text-left text-xs ${el.id === visible.selectedId ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover'}`}
                >
                  <span className="min-w-0 flex-1 truncate" title={el.name}>
                    {el.kind === 'text' ? `«${el.text}»` : el.name}
                  </span>
                  {/* Шрифт виден у каждой надписи: чтобы сравнить две, не надо тыкать в каждую. */}
                  {el.kind === 'text' && (
                    <span style={{ ...S.badge, fontFamily: `"${el.fontFamily}", sans-serif` }}>{el.fontFamily}</span>
                  )}
                  {el.kind === 'image' && !el.hasAlpha && <span style={S.badge}>фон не вырезан</span>}
                  {el.kind === 'image' && tagsOf[digestOf(el.src)]?.name && <NameChip named={tagsOf[digestOf(el.src)]!.name!} />}
                  {el.kind === 'image' && (tagsOf[digestOf(el.src)]?.tags ?? []).length > 0 && (
                    <TagChips tags={tagsOf[digestOf(el.src)]!.tags} />
                  )}
                </button>
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
                {[...current.versions].reverse().map((v) => (
                  <button
                    key={v.number}
                    onClick={() => v.number !== viewing && goTo(v.number)}
                    aria-current={v.number === viewing}
                    className={`rounded px-2 py-1 text-left text-xs ${v.number === viewing ? 'bg-primary-soft' : 'hover:bg-hover'}`}
                  >
                    версия {v.number} · {v.author_name ?? (v.author_id ? 'имя ещё не пришло' : 'без входа')} ·{' '}
                    {new Date(v.saved_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
              {viewing !== current.number && (
                <p className="text-xs text-warning">не последняя: сохранение ляжет новой версией поверх последней</p>
              )}
              <p className="text-xs text-muted-foreground">A и D — листать</p>
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
                  <span className="flex-1">{f.message}</span>
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
                onClick={downloadSheet}
                disabled={composition.elements.length === 0 || blocking(open).length > 0}
                className={small()}
                title={
                  blocking(open).length > 0
                    ? 'Сначала исправьте блокирующие находки: такой принт не пропечатается'
                    : 'Плоский лист в сантиметрах, мимо складок и света — он идёт на фабрику'
                }
              >
                печатный лист
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
                {size ? `, ${size}` : ''}: {describeSheet(visible).widthCm.toFixed(1)} ×{' '}
                {describeSheet(visible).heightCm.toFixed(1)} см, элементов {describeSheet(visible).items.length}
                {cal.provisional && ' · калибровка предварительная'}
              </p>
            )}
          </Section>
        </aside>
      </WorkFrame>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Клавиши окна">
        <table className="w-full text-sm">
          <tbody>
            {KEYS.map(([keys, what]) => (
              <tr key={keys}>
                <td className="whitespace-nowrap py-0.5 pr-4 font-mono text-xs">{keys}</td>
                <td className="py-0.5">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Клавиши работают в любой раскладке; в полях ввода буквы и цифры печатаются.
        </p>
      </Modal>

      {/* Правки не теряются молча: листание истории, другой референс, новый
          и уход со страницы спрашивают. Ответ по умолчанию — остаться. */}
      <Modal
        open={leaving !== null}
        onClose={() => {
          setLeaving(null)
          if (blocker.state === 'blocked') blocker.reset()
        }}
        title="Есть несохранённые правки"
        actions={
          <>
            <button
              className={buttonClass({ tone: 'neutral', variant: 'outline' })}
              onClick={() => {
                setLeaving(null)
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              остаться
            </button>
            <button
              className={buttonClass({ tone: 'danger', variant: 'outline' })}
              onClick={() => {
                const then = leaving?.then
                setLeaving(null)
                // Отказались — черновик больше не предлагать, иначе отказ
                // вернётся вопросом «восстановить?» при следующем открытии.
                if (current) forgetDraft(current.id)
                else forget()
                setBaseline(null)
                then?.()
              }}
            >
              не сохранять
            </button>
            {canSave && (
              <button
                className={buttonClass({ tone: 'accent', variant: 'solid' })}
                disabled={saving}
                onClick={() => {
                  const then = leaving?.then
                  void saveCard().then((ok) => {
                    if (!ok) return
                    setLeaving(null)
                    then?.()
                  })
                }}
              >
                сохранить
              </button>
            )}
          </>
        }
      >
        {current
          ? `Правки к референсу №${current.id} (поверх версии ${viewing}) ещё не сохранены.`
          : 'Этот принт ещё ни разу не сохранён.'}
      </Modal>

      <Modal
        open={draftOffer !== null}
        onClose={() => draftOffer && void dropDraft(draftOffer)}
        title="Восстановить несохранённое?"
        actions={
          <>
            <button
              className={buttonClass({ tone: 'neutral', variant: 'outline' })}
              onClick={() => draftOffer && void dropDraft(draftOffer)}
            >
              открыть сохранённую
            </button>
            <button
              className={buttonClass({ tone: 'accent', variant: 'solid' })}
              onClick={() => draftOffer && void restoreDraft(draftOffer)}
            >
              восстановить
            </button>
          </>
        }
      >
        {draftOffer &&
          `У референса №${draftOffer.card.id} остались правки поверх версии ${draftOffer.at}, которые не сохранили до закрытия.`}
      </Modal>
    </>
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

/** Ползунок показа. `hint` — что параметр делает на изделии словами, а не
 *  имя из шейдера: «гамма базы» без пояснения не говорит никому ничего. */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  digits,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  digits: number
  onChange: (v: number) => void
}) {
  return (
    <div>
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
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
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

/** Раздел панели или служебной полосы. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h2 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
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
