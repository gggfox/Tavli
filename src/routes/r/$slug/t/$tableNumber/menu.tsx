import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/r/$slug/t/$tableNumber/menu')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/r/$slug/t/$tableNumber/menu"!</div>
}
