// Generates a self-signed TLS cert for the device-testing loop (pnpm dev:device).
//
// Why: BrowserStack real devices reach the dev server as http://bs-local.com:3000,
// which is an insecure context — crypto.subtle is unavailable and clerk-js never
// initializes, so auth flows can't be exercised on-device. Serving vite over
// https (vite.config.ts reads these files under DEVICE_TESTING=1) makes
// bs-local.com a secure context; Automate runs accept the self-signed cert via
// the acceptInsecureCerts capability.
//
// Output lives in tmp/dev-certs/ (tmp/ is gitignored). Idempotent.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "tmp", "dev-certs");
const key = join(dir, "key.pem");
const cert = join(dir, "cert.pem");

if (existsSync(key) && existsSync(cert)) {
	console.log(`dev cert present: ${cert}`);
	process.exit(0);
}

mkdirSync(dir, { recursive: true });
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-keyout",
		key,
		"-out",
		cert,
		"-days",
		"365",
		"-nodes",
		"-subj",
		"/CN=bs-local.com",
		"-addext",
		"subjectAltName=DNS:bs-local.com,DNS:localhost,IP:127.0.0.1",
	],
	{ stdio: "inherit" }
);
console.log(`generated dev cert: ${cert}`);
