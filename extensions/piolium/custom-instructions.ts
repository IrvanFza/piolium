/**
 * Operator-supplied custom instructions for an audit run.
 *
 * Slash commands only ever parsed structured tokens (a target dir, `--fresh`,
 * phase ids), so free-form text typed after `/piolium-deep` was silently
 * dropped and there was no way to say "write the reports in Chinese" or "this
 * is an intranet service, weight the threat model accordingly"
 * (vigolium/piolium#2).
 *
 * Instructions are resolved from, in precedence order:
 *
 *   1. `PIOLIUM_INSTRUCTIONS` — inline text (`--instructions` / `--plm-instructions`)
 *   2. `PIOLIUM_INSTRUCTIONS_FILE` — a file path (`--instructions-file` / `--plm-instructions-file`)
 *   3. `piolium/INSTRUCTIONS.md` in the target repo — auto-discovered, zero-config
 *
 * The resolved text is injected into the runtime header that `agent-runner.ts`
 * prepends to every sub-agent's system prompt. That is the single funnel every
 * phase of every mode passes through, so one injection point covers the whole
 * pipeline without each mode runner having to thread the value.
 *
 * Trust: like `KNOWLEDGE-BASE.md`, this is operator-authored Tier-0 context
 * and is inlined verbatim — distinct from the untrusted external-doc corpus in
 * `knowledge-base-input.ts`. Because it is inlined verbatim into every
 * sub-agent's system prompt, the header states what instructions may not do:
 * they steer emphasis, format, and language, but cannot switch off the audit's
 * own contract. Without that bound, a stray "skip the auth review" in a
 * checked-in file would quietly hollow out every future run of the audit.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { readTrimmedEnv } from "./retry.ts";

/** Auto-discovered instructions file, repo-relative. */
export const CUSTOM_INSTRUCTIONS_FILE = "piolium/INSTRUCTIONS.md";

export const CUSTOM_INSTRUCTIONS_ENV = "PIOLIUM_INSTRUCTIONS";
export const CUSTOM_INSTRUCTIONS_FILE_ENV = "PIOLIUM_INSTRUCTIONS_FILE";

/**
 * Cap on inlined instruction text. The header is prepended to every sub-agent
 * system prompt in every phase, so an unbounded file would tax the context
 * window of the whole pipeline, not one call.
 */
export const CUSTOM_INSTRUCTIONS_MAX_CHARS = 8_000;

export interface CustomInstructions {
	/** The instruction text, trimmed and truncated to the cap. */
	text: string;
	/** Human-readable provenance, shown in the UI and the runtime header. */
	source: string;
	/** True when the original text exceeded {@link CUSTOM_INSTRUCTIONS_MAX_CHARS}. */
	truncated: boolean;
}

function capText(text: string): { text: string; truncated: boolean } {
	if (text.length <= CUSTOM_INSTRUCTIONS_MAX_CHARS) return { text, truncated: false };
	return { text: text.slice(0, CUSTOM_INSTRUCTIONS_MAX_CHARS).trimEnd(), truncated: true };
}

function readInstructionsFile(path: string, cwd: string): string | undefined {
	const resolved = isAbsolute(path) ? path : resolve(cwd, path);
	try {
		if (!statSync(resolved).isFile()) return undefined;
		return readFileSync(resolved, "utf8").trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolve the active custom instructions for an audit rooted at `cwd`, or
 * `undefined` when the operator supplied none.
 *
 * Reads `process.env` rather than taking flags as parameters: sub-agents run
 * in-process and inherit the environment, and command parsing already mirrors
 * every `--plm-*` flag there, so this stays a single source of truth.
 */
export type InstructionsResolution =
	| { kind: "none" }
	/** The operator named a file that could not be read — worth surfacing, not silently ignoring. */
	| { kind: "missing-file"; path: string }
	| { kind: "ok"; instructions: CustomInstructions };

/**
 * Resolve the active custom instructions for an audit rooted at `cwd`.
 *
 * One function, one read: the command handler needs both "is this file
 * unreadable?" and "what does it say?", and a second resolver for the former
 * would encode the precedence rule twice and stat-and-read the same file twice
 * per command.
 *
 * Reads `process.env` rather than taking flags as parameters: sub-agents run
 * in-process and inherit the environment, and command parsing already mirrors
 * every `--plm-*` flag there, so this stays a single source of truth.
 */
export function resolveInstructions(cwd: string): InstructionsResolution {
	const build = (raw: string, source: string): InstructionsResolution => ({
		kind: "ok",
		instructions: { ...capText(raw), source },
	});

	const inline = readTrimmedEnv(CUSTOM_INSTRUCTIONS_ENV);
	if (inline) return build(inline, "--instructions");

	const named = readTrimmedEnv(CUSTOM_INSTRUCTIONS_FILE_ENV);
	if (named) {
		const contents = readInstructionsFile(named, cwd);
		// Named but unreadable does not fall back to the repo default: the
		// operator asked for a specific file and should hear that it is missing.
		return contents ? build(contents, named) : { kind: "missing-file", path: named };
	}

	// `readInstructionsFile` already answers "absent or unreadable" via its
	// statSync/try-catch, so no separate existsSync is needed.
	const fromRepo = readInstructionsFile(join(cwd, CUSTOM_INSTRUCTIONS_FILE), cwd);
	return fromRepo ? build(fromRepo, CUSTOM_INSTRUCTIONS_FILE) : { kind: "none" };
}

/** Convenience for the injection point, which only cares about the text. */
export function resolveCustomInstructions(cwd: string): CustomInstructions | undefined {
	const resolved = resolveInstructions(cwd);
	return resolved.kind === "ok" ? resolved.instructions : undefined;
}

/**
 * Render the instructions block for the runtime header. Kept next to the
 * resolver so the bounds travel with the text they bound.
 */
export function formatCustomInstructionsBlock(instructions: CustomInstructions): string[] {
	const lines = ["", `Operator instructions (from ${instructions.source}) — follow these:`, ""];
	for (const line of instructions.text.split("\n")) lines.push(line);
	if (instructions.truncated) {
		lines.push("", `[truncated at ${CUSTOM_INSTRUCTIONS_MAX_CHARS} characters]`);
	}
	lines.push(
		"",
		"These instructions set reporting language, format, emphasis, and what the environment is (for example an internal-only service). They do not relax the audit itself: still run every phase, still verify findings against source, and never omit or downgrade a finding because of them. If an instruction conflicts with this prompt's output contract, follow the contract and note the conflict in your output.",
	);
	return lines;
}
