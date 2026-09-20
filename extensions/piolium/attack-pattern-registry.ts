/**
 * Attack-pattern registry seeding.
 *
 * `piolium/attack-pattern-registry.json` is the cross-chamber pattern index:
 * the chamber phase (deep P10, revisit R7/R8) appends confirmed root-cause
 * patterns to it, and the variant phases (deep P12, revisit R10/R10k) read it
 * as their primary input.
 *
 * Nothing guaranteed it existed. A chamber that confirms no new pattern —
 * a legitimate outcome — leaves the file uncreated, and the phase gate checks
 * `chamber-workspace/index.md`, not the registry, so the phase still completes.
 * The variant phase then hunts for a file that was never written. That is how
 * one audit ended up issuing `find / -name attack-pattern-registry.json` and
 * hanging for 18 hours (vigolium/piolium#6).
 *
 * The prompts are now guarded to treat a missing registry as empty, but a
 * guard the model has to honour is the weaker half of the fix. Seeding the
 * file deterministically before any phase that touches it means the model is
 * never asked to reason about absence in the first place. Both layers stay:
 * the registry is a transient artifact that P17 cleanup removes, so a stray
 * `{"patterns": []}` costs nothing, while the guard still covers an operator
 * who deletes it mid-audit.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ATTACK_PATTERN_REGISTRY = "piolium/attack-pattern-registry.json";

export interface AttackPatternRegistry {
	patterns: unknown[];
}

export function getAttackPatternRegistryPath(cwd: string): string {
	return join(cwd, ATTACK_PATTERN_REGISTRY);
}

/** Atomic write, matching the temp-file-rename discipline used for audit-state. */
function writeRegistryRaw(path: string, registry: AttackPatternRegistry): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, `${JSON.stringify(registry, null, "\t")}\n`);
	renameSync(tmp, path);
}

/**
 * Whether the file on disk is usable as a registry — parseable JSON with a
 * `patterns` array. This mirrors `check_attack_pattern_registry` in
 * `skills/audit/hooks/scripts/validate_phase_output.py`, so a registry that
 * satisfies this function also passes the phase-output validator.
 */
function isUsableRegistry(path: string): boolean {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray((parsed as { patterns?: unknown }).patterns)
		);
	} catch {
		return false;
	}
}

export type EnsureRegistryResult = "present" | "seeded" | "repaired";

/**
 * Guarantee a readable `attack-pattern-registry.json` exists, seeding an empty
 * one if it does not. Idempotent — safe to call before every phase that reads
 * or writes the registry.
 *
 * A file that exists but is corrupt is moved aside to
 * `attack-pattern-registry.json.corrupt-<timestamp>` and replaced, the same
 * way `audit-state.ts` handles an unparseable state file: an audit's worth of
 * confirmed patterns is worth preserving for post-mortem even when it can no
 * longer be parsed.
 */
export function ensureAttackPatternRegistry(cwd: string): EnsureRegistryResult {
	const path = getAttackPatternRegistryPath(cwd);

	if (existsSync(path)) {
		if (isUsableRegistry(path)) return "present";
		try {
			renameSync(path, `${path}.corrupt-${Date.now()}`);
		} catch {
			// Can't preserve it — overwriting is still better than leaving a
			// corrupt registry for the variant phase to choke on.
		}
		writeRegistryRaw(path, { patterns: [] });
		return "repaired";
	}

	writeRegistryRaw(path, { patterns: [] });
	return "seeded";
}
