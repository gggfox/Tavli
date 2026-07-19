// Real-device e2e for the landing page + sign-in flow (TAVLI-4).
//
// Run it with `pnpm test:e2e:device` — that wrapper (run.mjs) checks the dev
// server (`pnpm dev:device`), opens a cloudflared quick tunnel (real TLS cert;
// clerk-js needs a secure context, and iOS Safari can't be automated past the
// self-signed interstitial), and injects the Infisical dev env
// (BROWSERSTACK_* creds + CLERK_SECRET_KEY for test-user provisioning).
//
// Tiered verdicts, so partial failures are diagnosable:
//   layout      2x2 feature grid + CTA above the fold in the real viewport
//   clerkReady  clerk-js initialized; CTAs became real accounts.dev anchors
//   navigation  tapping Sign In lands on the Clerk hosted page
//   fullSignIn  pre-provisioned +clerk_test user signs in (password +
//               fixed new-device code 424242 — Clerk dev-instance test mode,
//               no email is sent) and lands authenticated on
//               /admin/restaurants
//
// Deliberate boundaries: the hosted SIGN-UP form is never automated (Clerk's
// invisible bot protection silently swallows it — that is an anti-abuse
// surface, not a bug to work around), and if a CAPTCHA appears the run stops
// and reports captchaBlocked.
//
// Not part of vitest (e2e/ is excluded) or Playwright (testMatch misses .mjs).
import { Builder, By, until } from "selenium-webdriver";

const APP_URL = process.env.DEVICE_APP_URL ?? "https://bs-local.com:3000/";
const DEVICE = process.env.DEVICE_NAME ?? "iPhone 14";
const OS_VERSION = process.env.DEVICE_OS_VERSION ?? "16";
// Clerk test mode (development instances only): +clerk_test emails sign in
// with the fixed code 424242 and no real email is sent. The user is
// pre-provisioned via the Backend API below — automating the hosted SIGN-UP
// form is a dead end (invisible bot protection silently swallows it), and
// that is Clerk's anti-abuse surface, not something an e2e should fight.
const TEST_EMAIL = "e2e+clerk_test@tavli.dev";
// This Clerk dev instance requires a password on user creation. Throwaway
// credentials for a test-mode user on a development instance — override via
// env if you rotate them.
const TEST_PASSWORD = process.env.E2E_TEST_USER_PASSWORD ?? "Tavli-e2e-device-424242!";

const USER = process.env.BROWSERSTACK_USERNAME;
const KEY = process.env.BROWSERSTACK_ACCESS_KEY;
if (!USER || !KEY) {
	console.error("FATAL: BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY not set");
	process.exit(2);
}

// Ensure the test user exists (idempotent). Needs CLERK_SECRET_KEY — the
// Infisical dev env provides it via `pnpm test:e2e:device`.
async function ensureTestUser() {
	const sk = process.env.CLERK_SECRET_KEY;
	if (!sk) return { ok: false, note: "CLERK_SECRET_KEY not in env — cannot provision test user" };
	const headers = { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" };
	const found = await fetch(
		`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_EMAIL)}`,
		{ headers }
	).then((r) => r.json());
	if (Array.isArray(found) && found.length > 0) return { ok: true, existed: true };
	const created = await fetch("https://api.clerk.com/v1/users", {
		method: "POST",
		headers,
		body: JSON.stringify({ email_address: [TEST_EMAIL], password: TEST_PASSWORD }),
	});
	if (!created.ok)
		return { ok: false, note: `user create failed: ${created.status} ${await created.text()}` };
	return { ok: true, existed: false };
}

// bs-local.com URLs need the BrowserStackLocal tunnel; public tunnel URLs
// (cloudflared, DEVICE_APP_URL=https://<x>.trycloudflare.com) do not.
const needsLocal = APP_URL.includes("bs-local.com");

const capabilities = {
	browserName: "safari",
	// Tolerate the self-signed dev cert (scripts/ensure-dev-cert.mjs) when
	// running against bs-local.com. NOTE: on real iOS this is NOT sufficient —
	// Safari still parks on the "This Connection Is Not Private" interstitial,
	// whose final confirm is a native sheet WebDriver can't reach, and
	// BrowserStack's acceptSsl action is a no-op on iOS 16. For auth flows on
	// device, use a real-cert tunnel instead (pnpm test:e2e:device does this
	// via cloudflared).
	acceptInsecureCerts: true,
	"bstack:options": {
		deviceName: DEVICE,
		osVersion: OS_VERSION,
		realMobile: "true",
		...(needsLocal && { local: "true" }),
		userName: USER,
		accessKey: KEY,
		projectName: "Tavli",
		buildName: "e2e-device",
		sessionName: `landing + sign-in (${DEVICE})`,
	},
};

const result = { device: `${DEVICE} / iOS ${OS_VERSION}`, tiers: {} };
const driver = await new Builder()
	.usingServer("https://hub.browserstack.com/wd/hub")
	.withCapabilities(capabilities)
	.build();

const session = await driver.getSession();
result.sessionUrl = `https://automate.browserstack.com/sessions/${session.getId()}`;

const setStatus = (status, reason) =>
	driver
		.executeScript(
			`browserstack_executor: ${JSON.stringify({
				action: "setSessionStatus",
				arguments: { status, reason: reason.slice(0, 250) },
			})}`
		)
		.catch(() => {});

// First VISIBLE element matching any selector — Clerk keeps hidden mirror
// inputs in the DOM (e.g. a password field on the identifier screen for
// password managers), and interacting with those throws.
const firstPresent = async (selectors, timeoutMs) => {
	const end = Date.now() + timeoutMs;
	for (;;) {
		for (const css of selectors) {
			const els = await driver.findElements(By.css(css));
			for (const el of els) {
				if (await el.isDisplayed().catch(() => false)) return { css, el };
			}
		}
		if (Date.now() > end) return null;
		await driver.sleep(500);
	}
};

try {
	await driver.manage().setTimeouts({ pageLoad: 60000, script: 30000 });
	await driver.get(APP_URL);

	// iOS Safari parks on the self-signed-cert interstitial despite
	// acceptInsecureCerts, and BrowserStack's acceptSsl action proved a no-op
	// on iOS 16 — so click through the warning page itself: it is a real DOM
	// document ("Show Details" → "visit this website" → native confirm, which
	// the alert API accepts). Do NOT re-navigate afterwards; that would just
	// mint a fresh warning.
	for (let i = 0; i < 4; i++) {
		const title = await driver.getTitle().catch(() => "");
		if (!/not private/i.test(title)) break;
		await driver
			.executeScript(
				`
				const els = [...document.querySelectorAll('a,button,[role="button"]')];
				const details = els.find(e => /show details/i.test(e.textContent));
				if (details) details.click();
			`
			)
			.catch(() => {});
		await driver.sleep(1000);
		await driver
			.executeScript(
				`
				const links = [...document.querySelectorAll('a,button,[role="button"]')];
				const visit = links.find(e => /visit this website/i.test(e.textContent));
				if (visit) visit.click();
			`
			)
			.catch(() => {});
		await driver.sleep(1500);
		// The final "Visit Website" confirmation is a native sheet.
		await driver
			.switchTo()
			.alert()
			.then((a) => a.accept())
			.catch(() => {});
		await driver.sleep(3000);
	}

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
	let signInAnchor = null;
	try {
		signInAnchor = await driver.wait(
			until.elementLocated(By.css('a[href*=".accounts.dev/sign-in"]')),
			30000
		);
		result.tiers.clerkReady = { pass: true };
	} catch {
		result.tiers.clerkReady = {
			pass: false,
			note: "CTAs never became anchors — check secureContext above and clerk keys",
		};
	}

	// ---- Tier 3: tap Sign In → Clerk hosted page ----------------------------
	if (signInAnchor) {
		await signInAnchor.click();
		await driver.wait(async () => (await driver.getCurrentUrl()).includes("accounts.dev"), 20000);
		result.tiers.navigation = { pass: true, url: (await driver.getCurrentUrl()).slice(0, 80) };
	}

	// ---- Tier 4: full sign-in round trip (clerk_test mode) ------------------
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

	if (result.tiers.navigation?.pass) {
		const provisioned = await ensureTestUser();
		if (!provisioned.ok) {
			result.tiers.fullSignIn = { pass: false, note: provisioned.note };
		} else {
			// We are on the hosted SIGN-IN page. The test user has no password, so
			// after the identifier Clerk goes to its email-code step, where
			// +clerk_test accepts 424242.
			const emailInput = await firstPresent(
				['input[name="identifier"]', 'input[name="emailAddress"]', 'input[type="email"]'],
				20000
			);
			if (!emailInput) throw new Error("fullSignIn: identifier input not found on hosted page");
			await emailInput.el.sendKeys(TEST_EMAIL);
			await mark("email typed");

			const captcha = await firstPresent(
				['iframe[src*="turnstile"]', 'iframe[src*="captcha"]', ".cl-captcha"],
				2000
			);
			if (captcha) {
				result.tiers.fullSignIn = {
					pass: false,
					captchaBlocked: true,
					note: "bot check appeared on sign-in — not automatable; run this tier manually",
				};
				throw new Error("fullSignIn: captcha");
			}

			const cont = await firstPresent([".cl-formButtonPrimary", 'button[type="submit"]'], 10000);
			await cont.el.click();
			await mark("continue clicked");

			// Second factor screen: password (this instance's primary) or the
			// email-code input (test mode accepts 424242) — handle whichever shows.
			const second = await firstPresent(
				[
					'input[name="password"]',
					'input[autocomplete="one-time-code"]',
					".cl-otpCodeFieldInput",
					'input[name="code"]',
				],
				20000
			);
			if (!second) throw new Error("fullSignIn: neither password nor code input appeared");
			if (second.css === 'input[name="password"]') {
				await second.el.sendKeys(TEST_PASSWORD);
				const submit = await firstPresent([".cl-formButtonPrimary", 'button[type="submit"]'], 8000);
				await submit.el.click();
				await mark("password submitted");
			} else {
				await second.el.sendKeys("424242");
				await mark("otp typed");
			}

			// Clerk may add a new-device email verification after the password
			// (factor-two). For +clerk_test users its code is also 424242. Poll:
			// type any code input that appears until we're redirected to the app.
			// NOTE: compare the parsed host, never url.includes(appHost) — the
			// hosted page's redirect_url query param contains the app host in
			// (barely) encoded form, so substring checks pass while still on Clerk.
			const appHost = new URL(APP_URL).host;
			const onApp = async () => {
				try {
					return new URL(await driver.getCurrentUrl()).host === appHost;
				} catch {
					return false;
				}
			};
			const otpSelectors = [
				'input[autocomplete="one-time-code"]',
				".cl-otpCodeFieldInput",
				'input[name="code"]',
			];
			const deadline = Date.now() + 45000;
			let inputsDumped = false;
			while (Date.now() < deadline) {
				if (await onApp()) break;
				if (!inputsDumped && (await driver.getCurrentUrl()).includes("factor-two")) {
					inputsDumped = true;
					trace.push({
						step: "factor-two inputs",
						inputs: await driver
							.executeScript(
								`return [...document.querySelectorAll('input')].map(i => ({
								name: i.name, type: i.type, ac: i.autocomplete,
								cls: (i.className || '').slice(0, 60), data: Object.keys(i.dataset)
							}));`
							)
							.catch(() => "?"),
					});
				}
				const code = await firstPresent(otpSelectors, 1);
				if (code) {
					const empty = await code.el.getAttribute("value").then((v) => !v);
					if (empty) {
						await code.el.sendKeys("424242");
						await mark("verification code typed");
					}
				}
				await driver.sleep(1500);
			}

			// Round trip: hosted page → back to the app → authed redirect.
			await driver.wait(onApp, 15000);
			await driver.wait(
				async () => (await driver.getCurrentUrl()).includes("/admin/restaurants"),
				30000
			);
			result.tiers.fullSignIn = {
				pass: true,
				email: TEST_EMAIL,
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
