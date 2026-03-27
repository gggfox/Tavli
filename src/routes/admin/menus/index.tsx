import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/menus/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/admin/menus/"!</div>
}
