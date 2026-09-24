// Принт принадлежит стороне изделия, а не режиму просмотра.
//
// Проверяется не «поле добавили», а следствия: показ не смешивает стороны,
// переключение ничего не теряет, печатный лист собирается по сторонам, а
// сохранённое без стороны читается как нанесённое на перед.

import { describe, expect, it } from 'vitest'

import { add, EMPTY, type ImageElement, type TextElement } from './composition'
import { onSide, sidesUsed, upgrade } from './sides'
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
