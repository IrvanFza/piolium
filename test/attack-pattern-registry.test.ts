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
	ensureAttackPatternRegistry,
	getAttackPatternRegistryPath,
} from "../extensions/piolium/attack-pattern-registry.ts";

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
		expect(ensureAttackPatternRegistry(cwd)).toBe("seeded");
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

		expect(ensureAttackPatternRegistry(cwd)).toBe("present");
		expect(readRegistry()).toEqual(existing);
	});

	it("is idempotent across the repeated pre-phase calls the modes make", () => {
		expect(ensureAttackPatternRegistry(cwd)).toBe("seeded");
		expect(ensureAttackPatternRegistry(cwd)).toBe("present");
		expect(ensureAttackPatternRegistry(cwd)).toBe("present");
	});

	it("repairs a corrupt registry, preserving the original alongside it", () => {
		mkdirSync(join(cwd, "piolium"), { recursive: true });
		writeFileSync(getAttackPatternRegistryPath(cwd), "{not json");

		expect(ensureAttackPatternRegistry(cwd)).toBe("repaired");
		expect(readRegistry()).toEqual({ patterns: [] });

		const preserved = readdirSync(join(cwd, "piolium")).filter((f) =>
			f.startsWith("attack-pattern-registry.json.corrupt-"),
		);
		expect(preserved).toHaveLength(1);
	});

	it("repairs valid JSON that is missing the patterns key the validator requires", () => {
		mkdirSync(join(cwd, "piolium"), { recursive: true });
		writeFileSync(getAttackPatternRegistryPath(cwd), JSON.stringify({ entries: [] }));

		expect(ensureAttackPatternRegistry(cwd)).toBe("repaired");
		expect(readRegistry()).toEqual({ patterns: [] });
	});

	it("writes a registry that satisfies the phase-output validator's shape check", () => {
		ensureAttackPatternRegistry(cwd);
		const parsed = readRegistry() as { patterns: unknown[] };
		expect(Array.isArray(parsed.patterns)).toBe(true);
	});
});
