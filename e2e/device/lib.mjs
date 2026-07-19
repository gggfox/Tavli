// Shared plumbing for the real-device e2e suite (BrowserStack Automate).
// See landing.mjs for the full context on why things are the way they are
// (secure context, cert interstitial, Clerk test mode, bot-protection limits).
import { Builder, By, until } from "selenium-webdriver";

export const APP_URL = process.env.DEVICE_APP_URL ?? "https://bs-local.com:3000/";
export const DEVICE = process.env.DEVICE_NAME ?? "iPhone 14";
export const OS_VERSION = process.env.DEVICE_OS_VERSION ?? "16";
// Clerk test mode (dev instances): +clerk_test emails, fixed code 424242.
export const TEST_EMAIL = "e2e+clerk_test@tavli.dev";
export const TEST_PASSWORD = process.env.E2E_TEST_USER_PASSWORD ?? "Tavli-e2e-device-424242!";

export function requireBrowserStackCreds() {
	const user = process.env.BROWSERSTACK_USERNAME;
	const key = process.env.BROWSERSTACK_ACCESS_KEY;
	if (!user || !key) {
		console.error("FATAL: BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY not set");
		process.exit(2);
	}
	return { user, key };
}

// Idempotently ensure the test user exists (Clerk Backend API; this instance
// requires a password on create). Never automate the hosted sign-up form —
// Clerk's invisible bot protection silently swallows it.
export async function ensureTestUser() {
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

export async function buildDriver(sessionName) {
	const { user, key } = requireBrowserStackCreds();
	const needsLocal = APP_URL.includes("bs-local.com");
	const driver = await new Builder()
		.usingServer("https://hub.browserstack.com/wd/hub")
		.withCapabilities({
			browserName: "safari",
			acceptInsecureCerts: true,
			"bstack:options": {
				deviceName: DEVICE,
				osVersion: OS_VERSION,
				realMobile: "true",
				...(needsLocal && { local: "true" }),
				userName: user,
				accessKey: key,
				projectName: "Tavli",
				buildName: "e2e-device",
				sessionName,
			},
		})
		.build();
	await driver.manage().setTimeouts({ pageLoad: 60000, script: 30000 });
	const session = await driver.getSession();
	return { driver, sessionUrl: `https://automate.browserstack.com/sessions/${session.getId()}` };
}

export const makeSetStatus = (driver) => (status, reason) =>
	driver
		.executeScript(
			`browserstack_executor: ${JSON.stringify({
				action: "setSessionStatus",
				arguments: { status, reason: reason.slice(0, 250) },
			})}`
		)
		.catch(() => {});

// First VISIBLE element matching any selector — Clerk keeps hidden mirror
// inputs in the DOM and interacting with those throws.
export const makeFirstPresent = (driver) => async (selectors, timeoutMs) => {
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

// Parse the host — NEVER url.includes(appHost): Clerk redirect_url params
// contain the app host barely-encoded, so substring checks lie.
export const makeOnApp = (driver, appUrl) => async () => {
	try {
		return new URL(await driver.getCurrentUrl()).host === new URL(appUrl).host;
	} catch {
		return false;
	}
};

// Best-effort click-through of iOS Safari's self-signed-cert interstitial
// (bs-local.com runs only; the cloudflared tunnel has a real cert and never
// shows it). Known-imperfect: the final confirm is a native sheet.
export async function acceptCertInterstitial(driver) {
	for (let i = 0; i < 4; i++) {
		const title = await driver.getTitle().catch(() => "");
		if (!/not private/i.test(title)) break;
		for (const label of ["show details", "visit this website"]) {
			await driver
				.executeScript(
					`const els = [...document.querySelectorAll('a,button,[role="button"]')];
					 const el = els.find(e => ${JSON.stringify(label)}.split(' ').every(w => e.textContent.toLowerCase().includes(w)));
					 if (el) el.click();`
				)
				.catch(() => {});
			await driver.sleep(1200);
		}
		await driver
			.switchTo()
			.alert()
			.then((a) => a.accept())
			.catch(() => {});
		await driver.sleep(3000);
	}
}

// From the landing page: tap the Sign In anchor, complete the hosted Clerk
// flow (password, then the new-device email code — 424242 in test mode), and
// wait until the app redirects to /admin/restaurants authenticated.
export async function signInFromLanding(driver, { mark = async () => {} } = {}) {
	const firstPresent = makeFirstPresent(driver);
	const onApp = makeOnApp(driver, APP_URL);

	const anchor = await driver.wait(
		until.elementLocated(By.css('a[href*=".accounts.dev/sign-in"]')),
		30000
	);
	await anchor.click();
	await driver.wait(async () => (await driver.getCurrentUrl()).includes("accounts.dev"), 20000);

	const emailInput = await firstPresent(
		['input[name="identifier"]', 'input[name="emailAddress"]', 'input[type="email"]'],
		20000
	);
	if (!emailInput) throw new Error("signIn: identifier input not found on hosted page");
	await emailInput.el.sendKeys(TEST_EMAIL);
	await mark("email typed");

	const captcha = await firstPresent(
		['iframe[src*="turnstile"]', 'iframe[src*="captcha"]', ".cl-captcha"],
		2000
	);
	if (captcha) throw new Error("signIn: captcha appeared — not automatable, run manually");

	const cont = await firstPresent([".cl-formButtonPrimary", 'button[type="submit"]'], 10000);
	await cont.el.click();
	await mark("continue clicked");

	const second = await firstPresent(
		[
			'input[name="password"]',
			'input[autocomplete="one-time-code"]',
			".cl-otpCodeFieldInput",
			'input[name="code"]',
		],
		20000
	);
	if (!second) throw new Error("signIn: neither password nor code input appeared");
	if (second.css === 'input[name="password"]') {
		await second.el.sendKeys(TEST_PASSWORD);
		const submit = await firstPresent([".cl-formButtonPrimary", 'button[type="submit"]'], 8000);
		await submit.el.click();
		await mark("password submitted");
	} else {
		await second.el.sendKeys("424242");
		await mark("otp typed");
	}

	// Possible factor-two (new-device email verification): type 424242 into
	// any empty code input that appears until we land back on the app.
	const otpSelectors = [
		'input[autocomplete="one-time-code"]',
		".cl-otpCodeFieldInput",
		'input[name="code"]',
	];
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		if (await onApp()) break;
		const code = await firstPresent(otpSelectors, 1);
		if (code && (await code.el.getAttribute("value").then((v) => !v))) {
			await code.el.sendKeys("424242");
			await mark("verification code typed");
		}
		await driver.sleep(1500);
	}

	await driver.wait(onApp, 15000);
	await driver.wait(
		async () => (await driver.getCurrentUrl()).includes("/admin/restaurants"),
		30000
	);
}
