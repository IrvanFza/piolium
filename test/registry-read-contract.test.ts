/**
 * Guards the contract broken in vigolium/piolium#6: an agent that hard-reads
 * `attack-pattern-registry.json` will, when the chamber phase legitimately
 * wrote no patterns, go hunting for it outside the repository.
 *
 * Every agent that reads the registry must say the read is conditional.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRuntimeHeader } from "../extensions/piolium/agent-runner.ts";
import { getBundledAgentsDir } from "../extensions/piolium/bundled-resources.ts";

const REGISTRY = "attack-pattern-registry.json";

/** Wording that marks a read as optional rather than required. */
const CONDITIONAL = /if it exists|if not yet cleaned up|missing|optional|if the file/i;

function agentFiles(): string[] {
	const dir = getBundledAgentsDir();
	return readdirSync(dir)
		.filter((name) => name.endsWith(".md"))
		.map((name) => join(dir, name));
}

describe("attack-pattern registry read contract", () => {
	it("is referenced by at least one agent, so this test cannot silently pass", () => {
		const referencing = agentFiles().filter((path) => readFileSync(path, "utf8").includes(REGISTRY));
		expect(referencing.length).toBeGreaterThan(0);
	});

	it("guards every agent's registry read as conditional", () => {
		const unguarded: string[] = [];

		for (const path of agentFiles()) {
			for (const line of readFileSync(path, "utf8").split("\n")) {
				if (!line.includes(REGISTRY)) continue;
				// Only reads need the guard; a write creates the file itself.
				if (/\b(update|create|write|append)\b/i.test(line)) continue;
				if (CONDITIONAL.test(line)) continue;
				unguarded.push(`${path.split("/").pop()}: ${line.trim()}`);
			}
		}

		expect(unguarded).toEqual([]);
	});
});

describe("runtime header", () => {
	it("tells every sub-agent to stay in the repo and treat missing files as empty", () => {
		const header = buildRuntimeHeader({ cwd: "/tmp/repo", mode: "deep", phase: "P12" });
		expect(header).toContain("Stay inside /tmp/repo");
		expect(header).toMatch(/never search outside the target repository/i);
	});
});
