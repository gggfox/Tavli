// Signed-in dashboard responsive audit on a real iPhone (TAVLI-4).
//
// Run: pnpm test:e2e:device -- dashboard-audit.mjs
// (run.mjs supplies the cloudflared tunnel; requires `pnpm dev:device`.)
//
// Signs in with the e2e test user, then visits every staff surface and
// measures it in the real Safari viewport:
//   hOverflow    document horizontal overflow in px (0 = fits)
//   mainHScroll  horizontal scroll inside <main>
//   offenders    widest elements protruding past the viewport (top 5)
//   error        error-boundary / not-authorized text if present
// The output is the "catalogue what breaks" list for the audit AC.
import { By, until } from "selenium-webdriver";
import {
	APP_URL,
	DEVICE,
	OS_VERSION,
	acceptCertInterstitial,
	buildDriver,
	ensureTestUser,
	makeSetStatus,
	signInFromLanding,
} from "./lib.mjs";

const ROUTES = [
	"/admin/restaurants",
	"/admin/orders",
	"/admin/menus",
	"/admin/reservations",
	"/admin/schedule",
	"/admin/team",
	"/admin/tabs",
	"/admin/payments",
	"/admin/users",
	"/admin/organizations",
	"/admin/feature-flags",
	"/dashboard",
];

const MEASURE = `
	const vw = window.innerWidth;
	const doc = document.documentElement;
	const offenders = [];
	for (const el of document.querySelectorAll("body *")) {
		const r = el.getBoundingClientRect();
		if (r.width > vw + 1 || r.right > vw + 8) {
			const cls = el.className && el.className.baseVal !== undefined
				? el.className.baseVal
				: el.className || "";
			offenders.push({
				w: Math.round(r.width),
				right: Math.round(r.right),
				el: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
					(cls ? "." + String(cls).trim().split(/\\s+/).slice(0, 3).join(".") : ""),
			});
			if (offenders.length > 80) break;
		}
	}
	offenders.sort((a, b) => b.w - a.w);
	const main = document.querySelector("main");
	const bodyText = document.body.innerText;
	const errorMatch = bodyText.slice(0, 800).match(/something went wrong|not authorized|page not found/i);
	return {
		vw,
		docW: Math.max(doc.scrollWidth, document.body.scrollWidth),
		hOverflow: Math.max(doc.scrollWidth, document.body.scrollWidth) - vw,
		mainHScroll: main ? main.scrollWidth - main.clientWidth : null,
		offenders: offenders.slice(0, 5),
		error: errorMatch ? bodyText.slice(0, 140) : null,
		bodyLen: bodyText.length,
	};
`;

const result = { device: `${DEVICE} / iOS ${OS_VERSION}`, routes: {} };
const { driver, sessionUrl } = await buildDriver(`dashboard audit (${DEVICE})`);
result.sessionUrl = sessionUrl;
const setStatus = makeSetStatus(driver);

try {
	await driver.get(APP_URL);
	await acceptCertInterstitial(driver);
	await driver.wait(
		until.elementLocated(By.xpath('//*[self::a or self::button][contains(., "Get Started")]')),
		30000
	);

	const provisioned = await ensureTestUser();
	if (!provisioned.ok) throw new Error(provisioned.note);
	await signInFromLanding(driver, {
		mark: async (s) => console.error(`signin: ${s}`),
	});
	console.error("signed in — auditing routes");

	const base = APP_URL.replace(/\/$/, "");
	for (const route of ROUTES) {
		await driver.get(base + route);
		// Let convex queries land and the surface settle.
		await driver.sleep(5000);
		result.routes[route] = await driver.executeScript(MEASURE);
		console.error(
			`${route}: hOverflow=${result.routes[route].hOverflow} mainHScroll=${result.routes[route].mainHScroll}` +
				(result.routes[route].error ? " ERROR" : "")
		);
	}

	const broken = Object.entries(result.routes).filter(
		([, m]) => m.hOverflow > 1 || (m.mainHScroll ?? 0) > 1 || m.error
	);
	result.verdict =
		broken.length === 0
			? "PASS: no horizontal overflow or errors on any audited route"
			: `AUDIT: ${broken.length}/${ROUTES.length} routes need work — ${broken.map(([r]) => r).join(", ")}`;
	await setStatus(broken.length === 0 ? "passed" : "failed", result.verdict);
} catch (e) {
	result.verdict = `FAIL: ${e.message.slice(0, 200)}`;
	result.dump = await driver
		.executeScript(
			`return {url: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0,250) : null};`
		)
		.catch(() => null);
	await setStatus("failed", e.message);
} finally {
	await driver.quit().catch(() => {});
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict.startsWith("FAIL") ? 1 : 0);
