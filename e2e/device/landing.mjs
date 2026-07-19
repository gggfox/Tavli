// Real-device e2e for the landing page + sign-in flow (TAVLI-4).
//
// Run it with `pnpm test:e2e:device` — the wrapper (run.mjs) checks the dev
// server (`pnpm dev:device`), opens a cloudflared quick tunnel (real TLS cert;
// clerk-js needs a secure context, and iOS Safari can't be automated past the
// self-signed interstitial), and injects the Infisical dev env
// (BROWSERSTACK_* creds + CLERK_SECRET_KEY for test-user provisioning).
//
// Tiered verdicts, so partial failures are diagnosable:
//   layout      2x2 feature grid + CTA above the fold in the real viewport
//   clerkReady  clerk-js initialized; CTAs became real accounts.dev anchors
//   navigation+fullSignIn  tapping Sign In → hosted Clerk flow (password +
//               fixed new-device code 424242, Clerk dev-instance test mode,
//               no email sent) → lands authenticated on /admin/restaurants
//
// Deliberate boundaries: the hosted SIGN-UP form is never automated (Clerk's
// invisible bot protection silently swallows it — an anti-abuse surface, not
// a bug to work around); if a CAPTCHA appears the run stops.
//
// Not part of vitest (e2e/ is excluded) or Playwright (testMatch misses .mjs).
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

const result = { device: `${DEVICE} / iOS ${OS_VERSION}`, tiers: {} };
const { driver, sessionUrl } = await buildDriver(`landing + sign-in (${DEVICE})`);
result.sessionUrl = sessionUrl;
const setStatus = makeSetStatus(driver);

const trace = [];
result.trace = trace;
const mark = async (step) =>
	trace.push({
		step,
		url: (await driver.getCurrentUrl().catch(() => "?")).slice(0, 90),
		body: await driver
			.executeScript("return document.body.innerText.slice(0, 180)")
			.catch(() => "?"),
	});

try {
	await driver.get(APP_URL);
	await acceptCertInterstitial(driver);

	// ---- Tier 1: layout -----------------------------------------------------
	await driver.wait(
		until.elementLocated(By.xpath('//*[self::a or self::button][contains(., "Get Started")]')),
		30000
	);
	result.tiers.layout = await driver.executeScript(`
		const main = document.querySelector('main');
		const cta = [...document.querySelectorAll('a,button')].find(e => /Get Started/.test(e.textContent));
		const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
		const r = cta.getBoundingClientRect();
		return {
			pass: document.querySelectorAll('.grid > div').length === 4
				&& r.bottom <= vh
				&& (main ? main.scrollHeight - main.clientHeight : 0) === 0,
			cards: document.querySelectorAll('.grid > div').length,
			visualViewportH: Math.round(vh),
			ctaBottom: Math.round(r.bottom),
			secureContext: window.isSecureContext,
		};
	`);

	// ---- Tier 2: clerk-js initializes (needs the secure context) ------------
	let clerkReady = true;
	try {
		await driver.wait(until.elementLocated(By.css('a[href*=".accounts.dev/sign-in"]')), 30000);
	} catch {
		clerkReady = false;
	}
	result.tiers.clerkReady = clerkReady
		? { pass: true }
		: { pass: false, note: "CTAs never became anchors — check secureContext and clerk keys" };

	// ---- Tiers 3+4: navigation + full sign-in round trip --------------------
	if (clerkReady) {
		const provisioned = await ensureTestUser();
		if (!provisioned.ok) {
			result.tiers.fullSignIn = { pass: false, note: provisioned.note };
		} else {
			await signInFromLanding(driver, { mark });
			result.tiers.fullSignIn = {
				pass: true,
				finalUrl: (await driver.getCurrentUrl()).slice(0, 90),
			};
		}
	}

	const failed = Object.entries(result.tiers).filter(([, t]) => t && t.pass === false);
	result.verdict = failed.length === 0 ? "PASS" : `FAIL: ${failed.map(([k]) => k).join(", ")}`;
	await setStatus(failed.length === 0 ? "passed" : "failed", result.verdict);
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
process.exit(result.verdict === "PASS" ? 0 : 1);
