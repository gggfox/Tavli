#!/usr/bin/env node
/**
 * Measure fallback metrics for the curated brand fonts (TAVLI-88).
 *
 * `font-display: swap` paints the fallback face first and swaps when the brand
 * face arrives. The two faces have different intrinsic proportions, so without
 * overrides the swap reflows every line of the menu — cumulative layout shift
 * on the one screen the restaurant paid to make feel like theirs. The four
 * `@font-face` descriptors this script computes make the *fallback* occupy the
 * brand face's space, so the swap exchanges glyphs without moving anything.
 *
 * The numbers must be measured, not guessed. Run this whenever a font file is
 * added or replaced, and paste the output into `convex/_shared/brandFonts.ts`.
 *
 *   node scripts/measureFontMetrics.mjs
 *
 * ## What it matches against
 *
 * `SYSTEM_FONT_STACK` resolves to a different concrete font on every OS, so no
 * single `size-adjust` is exact everywhere. We match against **Arial**, whose
 * metrics are fixed and which is the first *concrete, universally present*
 * face in that stack (`ui-sans-serif` and `-apple-system` are aliases that
 * resolve to the platform UI font). Matching a real, common fallback beats
 * matching an average of fonts nobody has.
 *
 * ## Why the widths come from `@capsizecss/metrics` and not from the file
 *
 * `size-adjust` is a ratio of average character widths, and the obvious source
 * — `OS/2.xAvgCharWidth` in the font itself — is **not comparable across
 * foundries**, because they do not all compute it the same way. Inter's OS/2
 * reports 1250/2048 em where its true frequency-weighted average is 978/2048;
 * dividing Inter's number by Arial's yields 138% instead of the correct 107%,
 * which would scale the fallback 29% too wide and reflow *worse* than shipping
 * no override at all. Capsize computes `xWidthAvg` the same way for every
 * family, so the ratio means something.
 *
 * The vertical metrics DO come from the vendored file, and are cross-checked
 * against capsize below: that check is the point of still parsing the woff2 at
 * all. It catches the case where the committed binary and the metrics package
 * describe different versions of a font — which would otherwise produce
 * plausible-looking overrides for a face nobody is serving.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import arialMetrics from "@capsizecss/metrics/arial";
import interMetrics from "@capsizecss/metrics/inter";
import frauncesMetrics from "@capsizecss/metrics/fraunces";
import spaceGroteskMetrics from "@capsizecss/metrics/spaceGrotesk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The fallback every brand face is matched against. See the module note. */
const ARIAL = arialMetrics;

/** woff2's known-table-tag table, indexed by the 6-bit tag id in each entry. */
const KNOWN_TAGS = [
	"cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
	"cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
	"EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
	"vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
	"CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
	"bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
	"gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
	"trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/** woff2 encodes lengths as a variable-width base-128 integer, high bit = continue. */
function readUIntBase128(buf, offset) {
	let result = 0;
	for (let i = 0; i < 5; i++) {
		const byte = buf[offset + i];
		// Leading zeros are forbidden by spec, and would let two encodings mean
		// the same number — reject rather than accept an ambiguous file.
		if (i === 0 && byte === 0x80) throw new Error("invalid UIntBase128: leading zero");
		result = result * 128 + (byte & 0x7f);
		if ((byte & 0x80) === 0) return [result, offset + i + 1];
	}
	throw new Error("invalid UIntBase128: too long");
}

/**
 * Pull the uncompressed bytes of the named tables out of a woff2 file.
 *
 * woff2 stores a table directory followed by one brotli stream holding every
 * table back to back. `head` and `hhea` are never "transformed" (only
 * `glyf`/`loca` are), so slicing them out of the decompressed stream gives the
 * original sfnt bytes and no transform needs undoing.
 */
function readWoff2Tables(path, wanted) {
	const buf = readFileSync(path);
	if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${path}: not a woff2 file`);

	const numTables = buf.readUInt16BE(12);
	let offset = 48; // fixed header length

	const directory = [];
	for (let i = 0; i < numTables; i++) {
		const flags = buf[offset++];
		const tagIndex = flags & 0x3f;
		let tag;
		if (tagIndex === 0x3f) {
			tag = buf.toString("latin1", offset, offset + 4);
			offset += 4;
		} else {
			tag = KNOWN_TAGS[tagIndex];
		}
		let origLength;
		[origLength, offset] = readUIntBase128(buf, offset);

		// Transform version 0 on glyf/loca means "transformed"; on every other
		// table, any non-zero version means transformed. Either way a
		// transformLength follows and it — not origLength — is the size in the
		// compressed stream.
		const transformVersion = (flags >> 6) & 0x03;
		const isTransformed =
			tag === "glyf" || tag === "loca" ? transformVersion === 0 : transformVersion !== 0;

		let transformLength = null;
		if (isTransformed) {
			[transformLength, offset] = readUIntBase128(buf, offset);
		}
		directory.push({ tag, length: transformLength ?? origLength });
	}

	const decompressed = brotliDecompressSync(buf.subarray(offset));

	const tables = {};
	let cursor = 0;
	for (const entry of directory) {
		if (wanted.includes(entry.tag)) {
			tables[entry.tag] = decompressed.subarray(cursor, cursor + entry.length);
		}
		cursor += entry.length;
	}
	for (const tag of wanted) {
		if (!tables[tag]) throw new Error(`${path}: missing ${tag} table`);
	}
	return tables;
}

/** Vertical metrics, read from the binary that is actually being served. */
function fontMetrics(path) {
	const { head, hhea } = readWoff2Tables(path, ["head", "hhea"]);
	return {
		unitsPerEm: head.readUInt16BE(18),
		ascent: hhea.readInt16BE(4),
		descent: hhea.readInt16BE(6),
		lineGap: hhea.readInt16BE(8),
	};
}

/**
 * Fail loudly when the committed font file and the metrics package disagree.
 *
 * Without this the script happily emits overrides derived from one version of
 * a font for a binary that is a different version — the numbers look fine, the
 * swap still reflows, and nothing anywhere reports a problem.
 */
function assertSameFont(id, fromFile, fromPackage) {
	for (const key of ["unitsPerEm", "ascent", "descent", "lineGap"]) {
		if (fromFile[key] !== fromPackage[key]) {
			throw new Error(
				`${id}: vendored woff2 reports ${key}=${fromFile[key]} but @capsizecss/metrics ` +
					`says ${fromPackage[key]}. The committed file and the metrics package are ` +
					`different versions of this font — re-run vendorBrandFonts.mjs, and if that ` +
					`does not resolve it, the packages have diverged and need aligning.`
			);
		}
	}
}

/** Percentage string with two decimals — the precision CSS descriptors use. */
const pct = (ratio) => `${(ratio * 100).toFixed(2)}%`;

/**
 * Build the four descriptors.
 *
 * `size-adjust` scales the fallback so its average character width matches the
 * brand face — that is what stops the line-break positions from moving. The
 * three vertical overrides are then divided by that same scale, because they
 * are expressed relative to the *adjusted* em box; forgetting the division is
 * the classic mistake and produces a fallback with the right widths and the
 * wrong line height, which reflows vertically instead of horizontally.
 */
function overridesFor(metrics, packageMetrics) {
	const brandWidthRatio = packageMetrics.xWidthAvg / packageMetrics.unitsPerEm;
	const fallbackWidthRatio = ARIAL.xWidthAvg / ARIAL.unitsPerEm;
	const sizeAdjustRatio = brandWidthRatio / fallbackWidthRatio;

	return {
		sizeAdjust: pct(sizeAdjustRatio),
		ascentOverride: pct(metrics.ascent / metrics.unitsPerEm / sizeAdjustRatio),
		descentOverride: pct(Math.abs(metrics.descent) / metrics.unitsPerEm / sizeAdjustRatio),
		lineGapOverride: pct(metrics.lineGap / metrics.unitsPerEm / sizeAdjustRatio),
	};
}

const FAMILIES = [
	{ id: "inter", file: "public/fonts/inter-latin.woff2", metrics: interMetrics },
	{ id: "fraunces", file: "public/fonts/fraunces-latin.woff2", metrics: frauncesMetrics },
	{
		id: "spaceGrotesk",
		file: "public/fonts/space-grotesk-latin.woff2",
		metrics: spaceGroteskMetrics,
	},
];

const results = {};
for (const family of FAMILIES) {
	const fromFile = fontMetrics(join(ROOT, family.file));
	assertSameFont(family.id, fromFile, family.metrics);
	results[family.id] = overridesFor(fromFile, family.metrics);
}

console.log("Paste into BRAND_FONTS in convex/_shared/brandFonts.ts:\n");
console.log(JSON.stringify(results, null, 2));
