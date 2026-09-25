// Ссылка набора платформы, переходящая роутером, а не перезагрузкой страницы.
//
// Меню рамки роутера не знает и зовёт ссылку своим href, а роутер ждёт to и
// сам подставляет приставку — поэтому её здесь снимают (routerPath).

import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { routerPath } from './sections'

export function RouterLink({
  href,
  children,
  ...rest
}: {
  href: string
  children?: ReactNode
  className?: string
  style?: CSSProperties
  title?: string
  'aria-current'?: 'page' | undefined
}) {
  return (
    <Link to={routerPath(href)} {...rest}>
      {children}
    </Link>
  )
}
