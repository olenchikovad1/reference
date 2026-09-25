// Рамка платформы вокруг экранов «Референса».
//
// Рамку даёт @platform/shell — своей шапки у приложения нет (З-11). Всё, что в
// рамке, приходит от платформы: соседние приложения, субъект, состав меню и
// значки разделов спрашиваются у её ядра, а не берутся из кода. Своего списка
// разделов рамка не получает: что показать, решает платформа; здесь — адреса.

import { AppShell, applyAppearance, saveAppearance, type Appearance } from '@platform/shell'
import { Icon } from '@platform/ui'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { useApplications, useProfile, useSections } from '../shared/api/platform'
import { RouterLink } from './links'
import { activeMenu, BASE, hrefOfChild, hrefOfCode, routerPath } from './sections'

/** Код приложения. Неизменен: на него выданы гранты. */
export const CODE = 'reference'

export function Shell({
  appearance,
  onAppearance,
  children,
}: {
  appearance: Appearance
  onAppearance: (next: Appearance) => void
  children: ReactNode
}) {
  const location = useLocation()
  const here = activeMenu(routerPath(BASE + location.pathname))
  const mine = useApplications()
  const own = useSections(CODE)
  const me = useProfile()

  return (
    <AppShell
      current={CODE}
      applications={(mine.data ?? []).map((one) => ({
        code: one.code,
        name: one.name,
        // home — код первой страницы, а не адрес: путь собирает тот, кто ставит ссылку.
        href: one.home ? `/${one.code}/${one.home}` : `/${one.code}/`,
        icon: <Icon name={one.icon as never} />,
        tone: one.tone,
      }))}
      home={{ href: '/platform/', name: 'Платформа', icon: <Icon name="layers" /> }}
      settings={{ href: '/platform/settings', name: 'Настройки', icon: <Icon name="settings" /> }}
      subject={{
        name: me.data?.display_name ?? '',
        email: me.data?.email,
        organization: me.data?.organization,
        avatar: me.data?.avatar,
        href: '/platform/me',
      }}
      appearance={appearance}
      onAppearanceChange={(next) => {
        const merged = { ...appearance, ...next }
        onAppearance(merged)
        // Применить, а не только запомнить: тема живёт атрибутом на документе.
        applyAppearance(merged)
        saveAppearance(merged)
      }}
      sections={(own.data ?? [])
        // Раздел, экрана которого в этой сборке нет, в меню не идёт.
        .filter((section) => hrefOfCode(section.code) !== null)
        .map((section) => ({
          code: section.code,
          name: section.name,
          href: hrefOfCode(section.code) as string,
          icon: <Icon name={section.icon as never} />,
          tone: section.tone,
          children: (section.children ?? [])
            .filter((child) => hrefOfChild(section.code, child.code) !== null)
            .map((child) => ({ code: child.code, name: child.name, href: hrefOfChild(section.code, child.code) as string })),
        }))}
      currentSection={here.section ?? undefined}
      currentSubsection={here.child ?? undefined}
      sectionLink={RouterLink}
      menuControls={{ position: true, view: false, collapse: false, language: false }}
      // Колокол ходит к сервису уведомлений платформы сам.
      notifications={{}}
    >
      {children}
    </AppShell>
  )
}
