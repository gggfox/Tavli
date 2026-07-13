Welcome to Tavli.

# Getting Started

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

## Convex environment

Set on each Convex deployment via the dashboard or `npx convex env set`:

- `CONVEX_ENV` — `development`, `staging`, or `production`. Gates dev-only
  features such as the role switcher in Settings, which lets any authenticated
  user adopt any role for testing. When unset (or set to anything other than
  `development`/`dev`), the role switcher returns `NOT_AUTHORIZED`. Always set
  this to `production` on prod deployments.
- `ENABLE_DEV_ROLE_SWITCHER` — must be set to a truthy value (`true`, `1`, or
  `yes`) **in addition to** `CONVEX_ENV=development` to enable the role
  switcher. Omit or leave unset on staging and production.

  ```bash
  npx convex env set CONVEX_ENV development           # local dev deployment
  npx convex env set ENABLE_DEV_ROLE_SWITCHER true    # enable role switcher locally
  npx convex env set --prod CONVEX_ENV production     # production deployment
  ```

## Stripe Configuration

### Frontend environment

- `VITE_STRIPE_PUBLISHABLE_KEY`

### Convex environment

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET`

The Stripe integration uses two webhook surfaces:

- `POST /stripe/webhook` for standard payment events
- `POST /stripe/connect-webhook` for Connect thin events

For local development, forward Stripe events with the Stripe CLI:

```bash
stripe listen --forward-to http://localhost:3210/stripe/webhook
stripe listen --thin-events "v2.core.account[requirements].updated,v2.core.account[configuration.recipient].capability_status_updated" --forward-thin-to http://localhost:3210/stripe/connect-webhook
```

Production rollout steps live in [`documentation/runbooks/stripe-go-live.md`](documentation/runbooks/stripe-go-live.md).

## Dokploy Runtime Secrets (Infisical)

The production container (built from [`Dockerfile`](./Dockerfile)) doesn't have secrets baked
in — [`docker-entrypoint.sh`](./docker-entrypoint.sh) fetches them from Infisical at startup via
a machine identity, so Dokploy only needs to hold the Infisical bootstrap credentials instead of
every individual secret (currently just `CLERK_SECRET_KEY`, since `VITE_*` values are baked in at
build time by CI and everything else is a Convex-side secret set via `npx convex env set`).

Set on the Dokploy application (Environment Settings):

- `INFISICAL_MACHINE_CLIENT_ID` / `INFISICAL_MACHINE_CLIENT_SECRET` — Universal Auth credentials
  for a machine identity scoped to read-only access on the Infisical `prod` environment.
- `INFISICAL_PROJECT_ID`, `INFISICAL_ENV`, `INFISICAL_API_URL` — optional; default to the Tavli
  project, `prod`, and `https://infisical.gggfox.com` respectively.

If the machine-identity credentials aren't set, the entrypoint falls back to starting the app
with whatever environment variables Dokploy injected directly — so this is backwards compatible
with the previous "set everything manually" setup.

## Staging and production deployment

Branch flow:

1. Merge to `main` → CI runs (lint, audit, typecheck, build, unit, e2e).
2. On green, CI fast-forwards `staging` → **Deploy Staging** builds `:staging`, deploys Convex
   (`aromatic-dog-762`), and pings Dokploy staging (`staging.tavliai.com`).
3. Manual **Promote to Production** workflow fast-forwards `production` from `staging` →
   **Deploy Production** builds `:production`, deploys Convex (`polite-antelope-545`), and
   pings Dokploy production (`tavliai.com`).

Secrets live in Infisical (`dev` / `staging` / `prod`). GitHub Actions only stores the Infisical
machine-identity credentials plus `PROMOTE_TOKEN` (PAT with bypass on protected branches).

One-time bootstrap (after creating a machine identity with read access to `staging` and `prod`):

```bash
export INFISICAL_MACHINE_CLIENT_ID=...
export INFISICAL_MACHINE_CLIENT_SECRET=...
export PROMOTE_TOKEN=ghp_...          # contents:write + bypass on staging/production
export CLERK_SECRET_KEY=sk_test_...   # SSR runtime; use live key for prod cutover
./scripts/bootstrap-deployment-secrets.sh
```

Dokploy (per environment) should only set:

- `INFISICAL_MACHINE_CLIENT_ID` / `INFISICAL_MACHINE_CLIENT_SECRET`
- `INFISICAL_ENV` — `staging` or `prod` (defaults to `prod` in `docker-entrypoint.sh`)

DNS: point `tavliai.com` and `staging.tavliai.com` A records at the Dokploy server. Traefik
domains are configured in each Dokploy application’s **Domains** tab.

Production cutover (Clerk live + Stripe live + prod Convex secrets) is deferred — see
[`documentation/runbooks/stripe-go-live.md`](documentation/runbooks/stripe-go-live.md).

# Building For Production

```bash
pnpm build
```

## Testing

Run the unit/component suite:

```bash
pnpm test
```

Run the coverage variant used by CI:

```bash
pnpm test:coverage
```

Run Playwright E2E checks:

```bash
pnpm test:e2e
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

## Routing

This project uses [TanStack Router](https://tanstack.com/router). The initial setup is a file based router. Which means that the routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add another a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you use the `<Outlet />` component.

Here is an example layout that includes a header:

```tsx
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Link } from "@tanstack/react-router";

export const Route = createRootRoute({
	component: () => (
		<>
			<header>
				<nav>
					<Link to="/">Home</Link>
					<Link to="/about">About</Link>
				</nav>
			</header>
			<Outlet />
			<TanStackRouterDevtools />
		</>
	),
});
```

The `<TanStackRouterDevtools />` component is not required so you can remove it if you don't want it in your layout.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
const peopleRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/people",
	loader: async () => {
		const response = await fetch("https://swapi.dev/api/people");
		return response.json() as Promise<{
			results: {
				name: string;
			}[];
		}>;
	},
	component: () => {
		const data = peopleRoute.useLoaderData();
		return (
			<ul>
				{data.results.map((person) => (
					<li key={person.name}>{person.name}</li>
				))}
			</ul>
		);
	},
});
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

### React-Query

React-Query is an excellent addition or alternative to route loading and integrating it into you application is a breeze.

First add your dependencies:

```bash
pnpm add @tanstack/react-query @tanstack/react-query-devtools
```

Next we'll need to create a query client and provider. We recommend putting those in `main.tsx`.

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ...

const queryClient = new QueryClient();

// ...

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);

	root.render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}
```

You can also add TanStack Query Devtools to the root route (optional).

```tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const rootRoute = createRootRoute({
	component: () => (
		<>
			<Outlet />
			<ReactQueryDevtools buttonPosition="top-right" />
			<TanStackRouterDevtools />
		</>
	),
});
```

Now you can use `useQuery` to fetch your data.

```tsx
import { useQuery } from "@tanstack/react-query";

import "./App.css";

function App() {
	const { data } = useQuery({
		queryKey: ["people"],
		queryFn: () =>
			fetch("https://swapi.dev/api/people")
				.then((res) => res.json())
				.then((data) => data.results as { name: string }[]),
		initialData: [],
	});

	return (
		<div>
			<ul>
				{data.map((person) => (
					<li key={person.name}>{person.name}</li>
				))}
			</ul>
		</div>
	);
}

export default App;
```

You can find out everything you need to know on how to use React-Query in the [React-Query documentation](https://tanstack.com/query/latest/docs/framework/react/overview).

## State Management

Another common requirement for React applications is state management. There are many options for state management in React. TanStack Store provides a great starting point for your project.

First you need to add TanStack Store as a dependency:

```bash
pnpm add @tanstack/store
```

Now let's create a simple counter in the `src/App.tsx` file as a demonstration.

```tsx
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import "./App.css";

const countStore = new Store(0);

function App() {
	const count = useStore(countStore);
	return (
		<div>
			<button onClick={() => countStore.setState((n) => n + 1)}>Increment - {count}</button>
		</div>
	);
}

export default App;
```

One of the many nice features of TanStack Store is the ability to derive state from other state. That derived state will update when the base state updates.

Let's check this out by doubling the count using derived state.

```tsx
import { useStore } from "@tanstack/react-store";
import { Store, Derived } from "@tanstack/store";
import "./App.css";

const countStore = new Store(0);

const doubledStore = new Derived({
	fn: () => countStore.state * 2,
	deps: [countStore],
});
doubledStore.mount();

function App() {
	const count = useStore(countStore);
	const doubledCount = useStore(doubledStore);

	return (
		<div>
			<button onClick={() => countStore.setState((n) => n + 1)}>Increment - {count}</button>
			<div>Doubled - {doubledCount}</div>
		</div>
	);
}

export default App;
```

We use the `Derived` class to create a new store that is derived from another store. The `Derived` class has a `mount` method that will start the derived store updating.

Once we've created the derived store we can use it in the `App` component just like we would any other store using the `useStore` hook.

You can find out everything you need to know on how to use TanStack Store in the [TanStack Store documentation](https://tanstack.com/store/latest).

# Demo files

Files prefixed with `demo` can be safely deleted. They are there to provide a starting point for you to play around with the features you've installed.

# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).
