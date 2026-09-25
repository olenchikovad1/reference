import { describe, expect, it } from 'vitest'

import manifest from '../../../manifest.reference.yaml?raw'
import { activeMenu, hrefOfChild, hrefOfCode, routerPath, SECTIONS, sectionOfPath } from './sections'

describe('разделы приложения', () => {
  it('те же коды и в том же порядке, что в манифесте для платформы', () => {
    // Раздел, которого нет в манифесте, платформа не пришлёт — и страница
    // станет недостижимой; раздел без адреса здесь пропадёт из меню молча.
    const block = manifest.slice(manifest.indexOf('\nsections:'), manifest.indexOf('\nright_sets:'))
    const inManifest = [...block.matchAll(/^  - code: ([a-z-]+)$/gm)].map((m) => m[1])
    expect(SECTIONS.map((s) => s.code)).toEqual(inManifest)
  })

  it('адрес для рамки — с приставкой, для роутера — без', () => {
    expect(hrefOfCode('prints')).toBe('/reference/prints')
    expect(hrefOfChild('review', 'my-tasks')).toBe('/reference/review/my-tasks')
    expect(routerPath('/reference/prints')).toBe('/prints')
    expect(routerPath('/reference')).toBe('/')
    expect(hrefOfCode('library')).toBeNull()
  })

  it('подсвечивается раздел и подпункт, в котором человек', () => {
    expect(activeMenu('/review/my-tasks')).toEqual({ section: 'review', child: 'my-tasks' })
    expect(activeMenu('/references/trash')).toEqual({ section: 'references', child: 'trash' })
    expect(activeMenu('/prints')).toEqual({ section: 'prints', child: null })
    expect(activeMenu('/')).toEqual({ section: null, child: null })
  })

  it('адрес относится к своему разделу — по нему решается «нет такого пути»', () => {
    expect(sectionOfPath('/products')).toBe('products')
    expect(sectionOfPath('/printsy')).toBeNull()
  })
})
