// Принт принадлежит стороне изделия, а не режиму просмотра.
//
// Проверяется не «поле добавили», а следствия: показ не смешивает стороны,
// переключение ничего не теряет, печатный лист собирается по сторонам, а
// сохранённое без стороны читается как нанесённое на перед.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, type ImageElement, type TextElement } from './composition'
import { moveToSide, onSide, otherSide, sidesUsed, upgrade } from './sides'
import { describe as describeSheet } from './sheet'

function picture(id: string, side: string): ImageElement {
  return {
    id,
    kind: 'image',
    name: id,
    src: `/x/${id}.png`,
    aspect: 1,
    hasAlpha: true,
    placement: { side, anchor: 'neck', dxCm: 0, dyCm: 10, widthCm: 20, rotation: 0 },
  }
}

function words(id: string, side: string): TextElement {
  return {
    id,
    kind: 'text',
    name: id,
    text: 'ЛЕТО',
    fontFamily: 'Inter',
    weight: 700,
    colourCode: 'WHITE',
    rgb: [255, 255, 255],
    textAspect: 3,
    placement: { side, anchor: 'neck', dxCm: 0, dyCm: 20, widthCm: 10, rotation: 0 },
  }
}

describe('показ по сторонам', () => {
  it('спереди не видно того, что нанесено на спину', () => {
    const c = add(add(EMPTY, picture('перед', 'front')), picture('спина', 'back'))
    expect(onSide(c, 'front').elements.map((e) => e.id)).toEqual(['перед'])
    expect(onSide(c, 'back').elements.map((e) => e.id)).toEqual(['спина'])
  })

  it('переключение стороны ничего не теряет', () => {
    // Отбор — это ВЗГЛЯД на композицию, а не правка. Если бы он менял её,
    // переключение вкладки стирало бы работу, и человек узнавал бы об этом
    // только вернувшись.
    const c = add(add(EMPTY, picture('перед', 'front')), picture('спина', 'back'))
    onSide(c, 'front')
    onSide(c, 'back')
    expect(c.elements).toHaveLength(2)
  })

  it('называет стороны, на которых что-то есть', () => {
    // Нужно, чтобы видеть про спину, не переключаясь на неё: иначе половина
    // работы забывается и сдаётся недоделанной.
    const c = add(add(EMPTY, picture('перед', 'front')), words('слова', 'back'))
    expect(sidesUsed(c)).toEqual({ front: 1, back: 1 })
  })
})

describe('печатный лист по сторонам', () => {
  it('перед и спина считаются раздельно', () => {
    // Печатаются они разными прогонами, и сведённые в один лист габариты
    // означают файл, который на фабрике не печатается ничем.
    const c = add(add(EMPTY, picture('перед', 'front')), picture('спина', 'back'))
    const front = describeSheet(onSide(c, 'front'))
    const back = describeSheet(onSide(c, 'back'))
    expect(front.items).toHaveLength(1)
    expect(back.items).toHaveLength(1)
    expect(front.items[0].name).toBe('перед')
  })
})

describe('сохранённое прошлой версией', () => {
  it('элемент без стороны читается как нанесённый на перед', () => {
    // Иначе открытая после обновления страница показывает пустое изделие, и
    // человек считает, что работа пропала.
    const old = {
      elements: [{ ...picture('старый', 'front'), placement: { anchor: 'neck', dxCm: 0, dyCm: 10, widthCm: 20, rotation: 0 } }],
      selectedId: null,
    }
    const fixed = upgrade(old as never)
    expect(fixed.elements[0].placement.side).toBe('front')
  })

  it('уже размеченное не трогается', () => {
    const c = add(EMPTY, picture('спина', 'back'))
    expect(upgrade(c).elements[0].placement.side).toBe('back')
  })
})

describe('номера элементов', () => {
  it('повторившийся номер в сохранённом получает новый', () => {
    // Счётчик номеров после перезагрузки начинался заново, и новый элемент
    // получал номер уже восстановленного. Правка одного правила оба, удаление
    // удаляло оба, а React при одинаковых ключах оставлял призрачные рамки.
    const twin = picture('el-2', 'front')
    const c = { elements: [twin, picture('el-4', 'back'), { ...twin, name: 'второй' }], selectedId: null }
    const ids = upgrade(c).elements.map((e) => e.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('el-2')
  })
})

describe('перенос на другую сторону', () => {
  it('принт уезжает на спину с тем же размером и высотой, остальные на месте', () => {
    const c = add(add(EMPTY, picture('a', 'front')), words('b', 'front'))
    const moved = moveToSide(c, 'a', 'back', ['neck', 'centre'])
    const a = moved.elements.find((e) => e.id === 'a')!
    expect(a.placement).toEqual({ ...picture('a', 'front').placement, side: 'back' })
    expect(moved.elements.find((e) => e.id === 'b')!.placement.side).toBe('front')
    expect(onSide(moved, 'back').elements.map((e) => e.id)).toEqual(['a'])
  })

  it('ориентира нет у новой стороны — от горловины', () => {
    const el = { ...picture('a', 'front'), placement: { ...picture('a', 'front').placement, anchor: 'pocket' } }
    const moved = moveToSide(add(EMPTY, el), 'a', 'back', ['neck'])
    expect(moved.elements[0].placement.anchor).toBe('neck')
  })

  it('перед ↔ спина, с бока не переносят', () => {
    expect(otherSide('front')).toBe('back')
    expect(otherSide('back')).toBe('front')
    expect(otherSide('left')).toBeNull()
  })
})
