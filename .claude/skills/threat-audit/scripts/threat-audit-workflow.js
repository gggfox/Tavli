export const meta = {
	name: "threat-audit",
	description:
		"Adversarial security audit of Tavli: threat model first, per-layer findings, confidence-labeled verification, synthesized attack chains + secure design",
	phases: [
		{ title: "Threat model" },
		{ title: "Audit layers" },
		{ title: "Verify" },
		{ title: "Synthesize" },
	],
};

// ---- Shared context every agent reads for itself ----
// Agents have full tool access and run from the repo root. Point them at the
// canonical sources rather than inlining a stale copy of the stack here.
const REF = ".claude/skills/threat-audit/REFERENCE.md";
const PRIMER =
	`This is the Tavli restaurant-ops app: src/ = TanStack Start SSR React frontend, convex/ = Convex ` +
	`Backend-as-a-Service (no SQL, no row-level security — every Convex function is a public RPC unless ` +
	`declared internal*, and must enforce its own authorization). Auth is Clerk; payments are Stripe. ` +
	`All paths are relative to the repo root. BEFORE doing anything, read ${REF} (Tavli asset inventory ` +
	`+ layer checklists + output rules), CLAUDE.md (architecture, layering, trust boundaries), ` +
	`CONTEXT.md (domain glossary), and skim documentation/tech-debt/ (known weak spots — treat as real ` +
	`until disproven). Static analysis only: read code/config, and you MAY run read-only checks ` +
	`(pnpm audit, inspect pnpm-lock.yaml, grep for secrets, list env usage). Do NOT attack a running ` +
	`service, send network exploitation, or mutate files.`;

// ---- Schemas ----
const TM_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["attackers", "entryPoints", "trustBoundaries", "assets"],
	properties: {
		attackers: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["type", "goal", "capability"],
				properties: {
					type: { type: "string" },
					goal: { type: "string" },
					capability: { type: "string" },
				},
			},
		},
		entryPoints: { type: "array", items: { type: "string" } },
		trustBoundaries: { type: "array", items: { type: "string" } },
		assets: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["asset", "why"],
				properties: { asset: { type: "string" }, why: { type: "string" } },
			},
		},
	},
};

const SEVERITY = { type: "string", enum: ["Critical", "High", "Medium", "Low"] };

const FINDING_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["findings"],
	properties: {
		findings: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"title",
					"severity",
					"component",
					"description",
					"exploitation",
					"impact",
					"fix",
				],
				properties: {
					title: { type: "string" },
					severity: SEVERITY,
					component: { type: "string", description: "file path or subsystem" },
					description: { type: "string" },
					exploitation: { type: "string", description: "concrete step-by-step exploitation path" },
					impact: { type: "string" },
					fix: { type: "string", description: "recommended remediation" },
				},
			},
		},
	},
};

const VERDICT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["confidence", "reasoning"],
	properties: {
		// Never drop a finding. Verification only labels it.
		confidence: { type: "string", enum: ["Confirmed", "Likely", "Speculative"] },
		reasoning: {
			type: "string",
			description: "why it survives/weakens after a refutation attempt",
		},
		severityAdjustment: {
			type: ["string", "null"],
			description: "new severity if the refutation justifies a change, else null",
		},
	},
};

const SYNTH_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["attackChains", "designImprovements"],
	properties: {
		attackChains: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["name", "steps", "outcome"],
				properties: {
					name: { type: "string" },
					steps: {
						type: "array",
						items: { type: "string" },
						description: "ordered chain of smaller issues",
					},
					outcome: { type: "string" },
				},
			},
		},
		designImprovements: { type: "array", items: { type: "string" } },
	},
};

// ---- Audit layers ----
const ALL_LAYERS = [
	{
		key: "frontend",
		focus:
			"TanStack Start SSR frontend (src/): XSS, dangerouslySetInnerHTML, secrets leaked through VITE_* or SSR loaders, open redirects, trust of client-supplied data, the UNAUTHENTICATED diner flows under src/routes/r/$slug/** (cart, checkout, ordering, reserve), TanStack server functions (src/start.ts), i18n content injection, SSR over-fetch returning fields the diner should not see.",
	},
	{
		key: "backend",
		focus:
			"Convex backend (convex/*.ts): Convex has NO row-level security, so every public query/mutation/action must enforce its own authz BEFORE any read/write. Hunt for missing/insufficient authz checks, IDOR across restaurantId/sessionId/orderId, loose or missing arg validators (mass assignment), internal* functions exposed publicly, and the HTTP routes in http.ts (reservations bot + Stripe webhooks). See documentation/tech-debt/0001-missing-backend-authentication.md.",
	},
	{
		key: "auth",
		focus:
			"Auth, sessions & permissions: Clerk config (auth.config.ts, CLERK_JWT_ISSUER_DOMAIN), RBAC helpers in convex/_util/auth.ts (org userRoles owner/admin vs per-restaurant restaurantMembers manager/employee, the userId-xor-employeeAccountId invariant, owner short-circuit), Personal-PIN hashing + PIN_LOCKOUT + shown-once resetEmployeePin, sharedEmployee.ts PIN step-up (bypass? read others data?), invite token flow (invites.ts getByTokenPublic/acceptInvitation, expiry/replay), admin impersonation, and the CONVEX_ENV-gated dev role switcher (does prod lock it?).",
	},
	{
		key: "database",
		focus:
			"Convex document store & storage (no SQL/RLS): data isolation enforced only in query code — confirm every list/get scopes by restaurant/org/user. Soft-delete + purge authz (restaurantPurge.ts, softDeletePurge.ts), file-storage upload authz (getEmployeePhotoUploadUrl), PII at rest (hashed PINs, reservation/customer data), idempotency (_util/idempotency.ts) and audit-trail (_util/audit.ts) integrity.",
	},
	{
		key: "infra",
		focus:
			"Deployment & config: CONVEX_ENV=production actually set on prod (convex/_util/env.ts gates dev-only powers), Stripe webhook signature verification on BOTH surfaces, RESERVATIONS_BOT_TOKEN strength + the hand-rolled constant-time compare in http.ts, secrets in console.* logs, CORS/headers on Convex HTTP routes, demo routes (src/routes/demo/**) shipping to prod, Vite/Nitro build config.",
	},
	{
		key: "dependencies",
		focus:
			"Third-party integrations & dependencies: run pnpm audit and inspect pnpm-lock.yaml. Scrutinize untrusted-input parsers in menu import (pdf-parse, mammoth, xlsx) and the AI path (ai / @ai-sdk/openai — prompt injection from uploaded menus), bcryptjs (PIN hashing params), Stripe/Clerk/Convex SDK currency, postinstall scripts (onlyBuiltDependencies: esbuild), abandoned/typosquat/supply-chain trust.",
	},
];

const requested =
	args && Array.isArray(args.layers) && args.layers.length
		? args.layers.map((s) => String(s).trim().toLowerCase())
		: ALL_LAYERS.map((l) => l.key);
const LAYERS = ALL_LAYERS.filter((l) => requested.includes(l.key));
if (!LAYERS.length)
	throw new Error(
		`No matching layers for ${JSON.stringify(requested)}. Valid: ${ALL_LAYERS.map((l) => l.key).join(", ")}`
	);

// ---- Phase 1: threat model ----
phase("Threat model");
log(
	`Threat-modeling, then auditing ${LAYERS.length} layer(s): ${LAYERS.map((l) => l.key).join(", ")}`
);
const threatModel = await agent(
	`${PRIMER}\n\nYou are a senior security engineer. Build a THREAT MODEL for this system, assuming a ` +
		`hostile environment with motivated attackers. Define attacker types and their goals/capabilities, ` +
		`enumerate entry points, identify trust boundaries, and list sensitive assets (data, secrets, tokens, ` +
		`permissions) with why each matters. Be specific to THIS repo, not generic.`,
	{ schema: TM_SCHEMA, phase: "Threat model" }
);
const TM = JSON.stringify(threatModel);

// ---- Phase 2+3: audit each layer, then verify each finding (pipelined, no barrier) ----
const perLayer = await pipeline(
	LAYERS,
	(layer) =>
		agent(
			`${PRIMER}\n\nThreat model (use as shared framing):\n${TM}\n\n` +
				`Audit the **${layer.key}** layer. Focus: ${layer.focus}\n\n` +
				`Think like a creative attacker, not a checklist scanner. Find Critical/High/Medium/Low issues, ` +
				`logic flaws (not just common patterns), multi-step paths, and non-obvious risks. If something looks ` +
				`risky but uncertain, INCLUDE it and explain why. Give concrete exploitation steps grounded in real ` +
				`file paths. Infer risk where context is missing. Be exhaustive.`,
			{ label: `audit:${layer.key}`, phase: "Audit layers", schema: FINDING_SCHEMA }
		),
	(res, layer) =>
		parallel(
			(res.findings || []).map(
				(f) => () =>
					agent(
						`${PRIMER}\n\nA prior agent reported this security finding in the ${layer.key} layer:\n` +
							`${JSON.stringify(f)}\n\nYou are an adversarial reviewer. Try to REFUTE it by reading the actual ` +
							`code: does the code really do what's claimed? Is the exploitation path reachable? Is the severity ` +
							`right? Do NOT delete the finding — instead assign a confidence label: "Confirmed" (you verified it ` +
							`is real and reachable), "Likely" (plausible, partial evidence), or "Speculative" (could not confirm ` +
							`or partially refuted, but worth flagging). Adjust severity only if justified.`,
						{ label: `verify:${layer.key}`, phase: "Verify", schema: VERDICT_SCHEMA }
					).then((v) => ({
						...f,
						layer: layer.key,
						confidence: v.confidence,
						verifyNote: v.reasoning,
						severity: v.severityAdjustment || f.severity,
					}))
			)
		)
);

const findings = perLayer.flat().filter(Boolean);
log(`${findings.length} finding(s) across ${LAYERS.length} layer(s); synthesizing.`);

// ---- Phase 4: synthesize attack chains + secure design ----
phase("Synthesize");
const synthesis = await agent(
	`${PRIMER}\n\nThreat model:\n${TM}\n\nVerified findings:\n${JSON.stringify(findings)}\n\n` +
		`Synthesize: (1) ATTACK CHAINS — realistic multi-step paths that compose smaller findings into ` +
		`bigger impact (state desync, weak trust assumptions, feature abuse, "impossible-but-possible" ` +
		`behavior). (2) SECURE DESIGN IMPROVEMENTS — higher-level changes that close classes of issues, ` +
		`not just individual bugs.`,
	{ schema: SYNTH_SCHEMA, phase: "Synthesize" }
);

return {
	threatModel,
	findings,
	attackChains: synthesis.attackChains,
	designImprovements: synthesis.designImprovements,
	layersAudited: LAYERS.map((l) => l.key),
};
