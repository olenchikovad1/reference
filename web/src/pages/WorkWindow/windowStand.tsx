import { useEffect, useRef } from 'react'
import { type PrintElement } from '../../shared/composition'
import { FONTS } from '../../shared/fonts'
import { assetUrl, fetchLibrary } from '../../shared/api/assets'
import { saveReference } from '../../shared/api/references'
import { WITHOUT_PLATFORM } from '../../shared/api/platform'
import { newElementId } from '../../shared/sides'
import { fetchCatalogue } from '../../shared/api/drops'
import { fetchTexts } from '../../shared/api/texts'
import { probeImage } from './work'
import { PRODUCT } from './constants'
import type { WindowState } from './windowState'
import type { WindowActions } from './windowActions'

// Наполнение витрины стенда (US-0684, план 114 — отдельным файлом): только стенд
// без платформы, из консоли браузера. Работе окна не нужно — поэтому не в действиях.

export function useStandFiller(s: WindowState, a: WindowActions) {
  const {
    setStateCode,
    setSize,
    history,
    setColourCode,
    setColourModelId,
    setCurrent,
    setViewing,
    setBaseline,
    aimed,
    setDraftHeld,
    onServer,
  } = s
  const {
    aspectOf,
    cacheImage,
    keep,
  } = a
  // Наполнение витрины стенда (US-0684): сотня разных референсов тем же
  // путём, что «Сохранить как», — со снимками сторон из этого окна. Снимок
  // рисует только окно, на сервере отрисовки нет; поэтому наполнение здесь, а
  // не скриптом мимо окна (так 28.09 на все карточки легла одна картинка).
  // Только стенд без платформы: `referenceStand.fill(120)` в консоли; третье
  // число — доля референсов с надписью из «Текстов» под принтом (US-0717).
  const standLive = useRef({ keep })
  standLive.current = { keep }
  useEffect(() => {
    if (!WITHOUT_PLATFORM) return
    const w = window as unknown as { referenceStand?: { fill: (n: number, seed?: number, withText?: number) => Promise<number[]> } }
    w.referenceStand = { fill: fillStand }
    return () => {
      delete w.referenceStand
    }
    // сеттеры стабильны, свежее — через standLive
  }, [])

  async function fillStand(n: number, from = 20260929, withText = 0): Promise<number[]> {
    // Пауза таймером, а не кадрами: окно в фоне кадров почти не получает, а
    // миниатюры рисуются в эффектах и кадров не ждут.
    const settle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const walk = (nodes: Awaited<ReturnType<typeof fetchCatalogue>>): { id: number; colour_code: string }[] =>
      nodes.flatMap((t) => [...t.models.filter((m) => m.code === PRODUCT).flatMap((m) => m.colour_models), ...walk(t.children)])
    const colourModels = walk(await fetchCatalogue())
    const prints = (await fetchLibrary()).filter((p) => !p.defect)
    if (!colourModels.length || !prints.length) throw new Error('на стенде нет цветомоделей B-HDY-14 или принтов')
    // Слоганы — заведённые в «Текстах» (scripts/stand/seed_slogans.py).
    const slogans = withText > 0 ? (await fetchTexts('')).map((t) => t.text) : []
    if (withText > 0 && !slogans.length) throw new Error('в «Текстах» пусто — сначала scripts/stand/seed_slogans.py')
    // Детерминированно: то же зерно — тот же набор; другое зерно — другой.
    let seed = from
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]
    const made: number[] = []
    const broken: string[] = []
    for (let i = 0; i < n; i++) {
      const p = pickOne(prints)
      const cm = pickOne(colourModels)
      const side = pickOne(['front', 'back'] as const)
      const src = assetUrl(p.digest, 'preview')
      const probed = await probeImage(src).catch(() => null)
      if (!probed) {
        // Картинки нет в хранилище — её в наборе не будет, и это названо.
        broken.push(p.file_name)
        prints.splice(prints.indexOf(p), 1)
        if (!prints.length) throw new Error('ни одна картинка библиотеки не загрузилась')
        i--
        continue
      }
      const { aspect, hasAlpha } = probed
      cacheImage(src)
      aimed.current = null
      onServer.current = null
      setCurrent(null)
      setViewing(null)
      setBaseline(null)
      setDraftHeld(null)
      setColourModelId(cm.id)
      setColourCode(cm.colour_code)
      setSize(pickOne([98, 104, 110, 116, 122, 128, 134, 140, 146, 152, 158, 164]))
      setStateCode(side)
      const dxCm = pickOne([-4, -2, 0, 2, 4])
      const dyCm = pickOne([8, 10, 12, 14])
      const widthCm = pickOne([10, 14, 18, 22])
      const elements: PrintElement[] = [
        { id: newElementId(), kind: 'image', name: p.name?.name ?? p.file_name, src, aspect, hasAlpha, placement: { side, anchor: 'neck', dxCm, dyCm, widthCm, rotation: 0 } },
      ]
      if (slogans.length && rnd() < withText) {
        // Надпись под принтом: светлая на тёмной кофте, тёмная на светлой.
        const light = /WHITE|MILK|CREAM|GREY|BEIGE/.test(cm.colour_code)
        const style = { text: pickOne(slogans), fontFamily: pickOne(FONTS).family, weight: 600, rgb: (light ? [20, 20, 20] : [255, 255, 255]) as [number, number, number] }
        elements.push({
          id: newElementId(),
          kind: 'text',
          name: 'надпись',
          ...style,
          colourCode: light ? 'BLACK' : 'WHITE',
          textAspect: aspectOf(style),
          placement: { side, anchor: 'neck', dxCm, dyCm: dyCm + widthCm / aspect + 2, widthCm: pickOne([14, 16, 18]), rotation: 0 },
        })
      }
      history.open(null, { selectedId: null, elements })
      // Кадр и миниатюры сторон должны лечь до снимка: окно перерисовалось,
      // картинка загружена, миниатюры догнали работу.
      await settle(250)
      const saved = await standLive.current.keep((body) => saveReference({ ...body, colour_model_id: cm.id, forked_from: null }))
      if (!saved) throw new Error(`№${i + 1} из ${n} не сохранился — смотрите подсказку окна`)
      made.push(saved.id)
      // После «Сохранить как» окно само переходит на новый номер и открывает
      // его; следующая работа, положенная раньше, чем открытие закончилось,
      // записывалась черновиком к только что сохранённой карточке.
      await settle(600)
      if ((i + 1) % 10 === 0) console.info(`наполнение стенда: ${i + 1} из ${n}`)
    }
    if (broken.length) console.warn(`наполнение стенда: не загрузились и пропущены — ${broken.join(', ')}`)
    return made
  }

}
