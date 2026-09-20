import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	REGISTRY_READER_AGENTS,
	ensureAttackPatternRegistry,
	getAttackPatternRegistryPath,
} from "../extensions/piolium/attack-pattern-registry.ts";
import { getBundledAgentsDir } from "../extensions/piolium/bundled-resources.ts";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "piolium-registry-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function readRegistry(): unknown {
	return JSON.parse(readFileSync(getAttackPatternRegistryPath(cwd), "utf8"));
}

describe("ensureAttackPatternRegistry", () => {
	it("seeds an empty registry when the chamber phase never wrote one", () => {
		ensureAttackPatternRegistry(cwd);
		expect(readRegistry()).toEqual({ patterns: [] });
	});

	it("creates the piolium/ directory if the audit has not yet", () => {
		expect(existsSync(join(cwd, "piolium"))).toBe(false);
		ensureAttackPatternRegistry(cwd);
		expect(existsSync(getAttackPatternRegistryPath(cwd))).toBe(true);
	});

	it("leaves a populated registry untouched", () => {
		mkdirSync(join(cwd, "piolium"), { recursive: true });
		const existing = { patterns: [{ id: "deserialization", confirmed_instances: ["a.java"] }] };
		writeFileSync(getAttackPatternRegistryPath(cwd), JSON.stringify(existing));

		ensureAttackPatternRegistry(cwd);
		expect(readRegistry()).toEqual(existing);
	});

	it("is idempotent across the repeated pre-phase calls the modes make", () => {
		ensureAttackPatternRegistry(cwd);
		const seeded = readRegistry();
		ensureAttackPatternRegistry(cwd);
		ensureAttackPatternRegistry(cwd);
		expect(readRegistry()).toEqual(seeded);
		// A no-op call must not leave a backup behind.
		expect(readdirSync(join(cwd, "piolium")).filter((f) => f.includes(".corrupt-"))).toEqual([]);
	});

	it("repairs a corrupt registry, preserving the original alongside it", () => {
		mkdirSync(join(cwd, "piolium"), { recursive: true });
		writeFileSync(getAttackPatternRegistryPath(cwd), "{not json");

		ensureAttackPatternRegistry(cwd);
		expect(readRegistry()).toEqual({ patterns: [] });

		const preserved = readdirSync(join(cwd, "piolium")).filter((f) =>
			f.startsWith("attack-pattern-registry.json.corrupt-"),
		);
		expect(preserved).toHaveLength(1);
	});

	it("repairs valid JSON that is missing the patterns key the validator requires", () => {
		mkdirSync(join(cwd, "piolium"), { recursive: true });
		writeFileSync(getAttackPatternRegistryPath(cwd), JSON.stringify({ entries: [] }));

		ensureAttackPatternRegistry(cwd);
		expect(readRegistry()).toEqual({ patterns: [] });
	});

	it("writes a registry that satisfies the phase-output validator's shape check", () => {
		ensureAttackPatternRegistry(cwd);
		const parsed = readRegistry() as { patterns: unknown[] };
		expect(Array.isArray(parsed.patterns)).toBe(true);
	});
});

describe("REGISTRY_READER_AGENTS", () => {
	it("covers every bundled agent that reads the registry", () => {
		// Seeding is keyed off the agent, not the phase id, so this set is what
		// makes balanced L5 and merge M2 work. A new reader added to agents/
		// without being listed here silently loses the seed.
		const dir = getBundledAgentsDir();
		const readers = readdirSync(dir)
			.filter((f) => f.endsWith(".md"))
			.filter((f) => readFileSync(join(dir, f), "utf8").includes("attack-pattern-registry.json"))
			.map((f) => f.replace(/\.md$/, ""));

		expect([...readers].sort()).toEqual([...REGISTRY_READER_AGENTS].sort());
	});
});
