// Orchestrates a device e2e run:
//   1. checks the dev server (pnpm dev:device) is serving https on :3000
//   2. opens a cloudflared quick tunnel to it (real TLS cert — iOS Safari
//      cannot be automated past the self-signed-cert interstitial, so device
//      auth flows must come through a publicly trusted cert)
//   3. runs landing.mjs against the tunnel URL
//   4. tears the tunnel down
//
// The dev server is only publicly reachable at the random trycloudflare URL
// for the duration of the run.
import { spawn } from "node:child_process";
import { get } from "node:https";

const DEV_SERVER = "https://127.0.0.1:3000/";

const fetchStatus = (url, { insecure = false } = {}) =>
	new Promise((resolve) => {
		const req = get(url, { rejectUnauthorized: !insecure, timeout: 8000 }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", () => resolve(0));
		req.on("timeout", () => {
			req.destroy();
			resolve(0);
		});
	});

// 1. Dev server up?
if ((await fetchStatus(DEV_SERVER, { insecure: true })) !== 200) {
	console.error(`FATAL: dev server not serving ${DEV_SERVER} — start \`pnpm dev:device\` first`);
	process.exit(2);
}

// 2. Quick tunnel. --no-tls-verify: the local side uses the self-signed dev cert.
const tunnel = spawn(
	"cloudflared",
	["tunnel", "--url", "https://127.0.0.1:3000", "--no-tls-verify"],
	{ stdio: ["ignore", "pipe", "pipe"] }
);
const tunnelUrl = await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error("cloudflared: no tunnel URL within 30s")), 30000);
	const scan = (chunk) => {
		const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
		if (m) {
			clearTimeout(timer);
			resolve(m[0]);
		}
	};
	tunnel.stdout.on("data", scan);
	tunnel.stderr.on("data", scan);
	tunnel.on("exit", (code) => reject(new Error(`cloudflared exited early (${code})`)));
}).catch((e) => {
	console.error(`FATAL: ${e.message}`);
	tunnel.kill();
	process.exit(2);
});
console.error(`tunnel: ${tunnelUrl}`);

// 3. Wait for the edge to route (DNS + first hop), then run the test.
for (let i = 0; i < 30; i++) {
	if ((await fetchStatus(`${tunnelUrl}/`)) === 200) break;
	await new Promise((r) => setTimeout(r, 2000));
}

const test = spawn(process.execPath, [new URL("./landing.mjs", import.meta.url).pathname], {
	stdio: "inherit",
	env: { ...process.env, DEVICE_APP_URL: `${tunnelUrl}/` },
});
const code = await new Promise((resolve) => test.on("exit", resolve));

// 4. Teardown.
tunnel.kill();
process.exit(code ?? 1);
