# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project at a glance

Piolium is a Pi extension (a plugin for `@earendil-works/pi-coding-agent`) that ships a multi-phase repository security audit pipeline. It is **not** a standalone CLI — it's loaded into a `pi` session, which then exposes the `/piolium-*` slash commands defined here. The bundled sub-agents (`agents/`) and skills (`skills/`) are committed to the repo.

Runtime is **Bun ≥1.1.0** (see `package.json#engines`). All Pi SDK packages are listed as `peerDependencies` and provided by the host `pi` process.

## Commands

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run lint        # biome check .
bun run format      # biome format --write .
bun run test        # vitest run (fileParallelism: false — audit-state tests touch real fs)

# Run a single test file or filter by name
bun run test -- test/scheduler.test.ts
bun run test -- -t "phase status strip"

# Dev install into Pi (edits in this checkout land immediately, no reinstall)
pi install ./
# Or load the extension ad-hoc without touching settings:
pi -e ./extensions/piolium/index.ts
```

Driving the extension once installed: `pi -p "/piolium-balanced --fresh"` (one-shot) or start `pi` and type `/piolium-status`. End-to-end harness check: `/piolium-smoke`.

## Architecture

### Extension surface (`extensions/piolium/index.ts`)

The default export `pioliumExtension(pi)` is the single entry point Pi calls per session. It:

1. Registers session flags (`--plm-dir`, `--plm-since`, `--plm-scan-limit`, `--plm-scan-since`, and the `--plm-*-retries`/`--plm-*-backoff*` family). Each flag mirrors to a `PIOLIUM_*` env var via `applyPioliumProcessFlagEnv` so downstream modules read a single source of truth (`process.env`).
2. Registers a `piolium-stream` message renderer that pretty-prints sub-agent tool-call/result events nested under the originating phase tag.
3. Registers each `/piolium-*` slash command. Every handler delegates to a mode runner under `extensions/piolium/modes/` and wires phase-strip UI through `createPhaseStripCommandUi`.
4. Registers the bundled `anthropic-vertex` provider (`providers/anthropic-vertex.ts`), but only when Vertex looks configured — `isAnthropicVertexConfigured()` gates it on the `PIOLIUM_VERTEX` override or any Google/Vertex env var, so a plain install doesn't advertise a provider it can't authenticate. `PIOLIUM_VERTEX` is read straight from `process.env` (no `--plm-*` flag): flag env mirroring runs during command parsing, which is *after* this init-time registration, so a flag couldn't take effect here.

The renderer + flag + provider registration are global side effects — be careful adding more, since they run on every Pi session start.

### Mode runners and phases

Each slash command corresponds to one runner in `extensions/piolium/modes/`:

- `lite.ts` (Q0–Q3), `balanced.ts` (L1–L7 incl. L6b/L6c), `deep.ts` (P1–P17), `confirm.ts` (V1–V7), `revisit.ts` (R5–R11c), `merge.ts` (M1–M7), `diff.ts` (D1)

The canonical phase order per mode lives in `modes.ts` (`MODE_PHASES`). Phase ids are a persisted on-disk contract — `audit-state.json` files reference them. **Don't rename phase keys** — they must stay stable across versions and any interoperating tooling. Display labels are in `phase-labels.ts`. Per-phase semantics + outputs are documented in `docs/phase-reference.md`.

Each phase invocation goes through `modes/phase-runner.ts`, which owns:
- audit-state transitions (pending → in_progress → complete/failed/skipped)
- per-phase retry with exponential backoff (defaults 2 retries, 5s base, 120s cap; tunable via `PIOLIUM_PHASE_*` / `--plm-phase-*`)
- heartbeat tracking so the UI proves a quiet phase is still alive

A separate retry layer in `index.ts#runCommandWithRetry` wraps the entire slash-command handler (`PIOLIUM_COMMAND_*` / `--plm-command-*`, default 3 retries). When adding a new mode, route both layers — phase retries inside the orchestrator, command retries around the handler call site.

### Sub-agent runner (`agent-runner.ts`)

Phases delegate work to specialist sub-agents via `runAgent`, which spawns a child Pi session **in-process** through `createAgentSession` (not a `pi --mode json` subprocess). This means auth, model registry, and resource discovery are inherited from the parent. Each run gets a transcript dir at `<cwd>/piolium/tmp/piolium/runs/<runId>/` containing `prompt.md`, `transcript.jsonl`, `result.md`, and (on failure) `error.txt`.

Child sessions load with `noExtensions: true`, so an extension-level `pi.on("tool_call")` hook never fires for them and the builtin `bash` can't be policed from the extension layer. Instead the runner registers a guarded `bash` in `customTools` (`tools/bash-guard.ts`) — a same-named custom tool shadows the builtin in the child's registry. It adds a default command timeout (`--plm-bash-timeout`, 15m) plus a whole-filesystem/destructive blocklist enforced in a `BashSpawnHook` (`--plm-bash-blocklist`, `--plm-bash-guard 0` to disable). Without it an unbounded command hangs the phase forever: most phases pass no `timeoutMs`, so nothing else ever fires the abort.

The runner does **not** enforce concurrency — call sites schedule through `scheduler.ts`, a tiny FIFO with a hard `maxConcurrent` cap (default 3, matching Deep mode's "Swarm Burst Cap"; override via `--plm-max-agents` / `PIOLIUM_MAX_AGENTS`, resolved per-run by `resolveBurstCap()`). Per-task `AbortSignal` and timeout propagate cleanly.

### Sub-agent definitions (`agents/`)

Sub-agents are Claude Code–style markdown files with YAML frontmatter (description, tools, model, skills). The loader in `agents.ts` translates Claude tool names (`Read`, `Glob`, `Bash`, `Agent`, `WebFetch`, …) to Pi names (`read`, `find`, `bash`, `spawn_agent`, …) at load time so the source files stay faithful to upstream. `SendMessage` is dropped — Pi has no inter-agent messaging primitive; orchestrators coordinate via shared files instead. Agents are package-private (Pi has no first-class `agents` resource type).

Skills (`skills/`) are surfaced through Pi's progressive skill loader (`/skill:codeql`, `/skill:semgrep`, `/skill:vuln-report`, …) — every directory becomes a skill.

### Audit state (`audit-state.ts`)

Durable resumable state lives at `<cwd>/piolium/audit-state.json`. **Snake-case keys are intentional** — they're the persisted on-disk contract read back when resuming or reporting an audit. Writes go through `withFileMutationQueue` (process-local serialization) plus temp-file-rename (atomic on POSIX), preventing both intra-process races and partially-written files on crash. Don't bypass this with raw `writeFileSync` to that path. A corrupt/unparseable state file is moved aside to `audit-state.json.corrupt-<timestamp>` rather than silently overwritten.

### Output layout (under target repo's `piolium/` dir)

`attack-surface/` (durable context, recon/KB/SAST/probe summaries), `findings-draft/` (candidates), `findings/<id>-<slug>/` (final, with `draft.md`/`poc.*`/`evidence/`/`report.md`), `final-audit-report.md`, `confirm-workspace/`, `tmp/piolium/runs/<runId>/`. Deep P17 removes transient workspaces after verification. Full table in `docs/output-structure.md`.

Maintainers may also check in `piolium/KNOWLEDGE-BASE.md` (legacy name `piolium/INFO.md` still honored) — a hand-curated, authoritative project-context file the `knowledge-base-builder` agent inlines. Presence is surfaced to sub-agents via `PIOLIUM_KNOWLEDGE_BASE_AVAILABLE`, set per command in `parseCommandTargetOrNotify` through `applyKnowledgeBaseAvailableEnv` (`knowledge-base-file.ts`). This is *trusted* Tier-0 context, distinct from the *untrusted* external-doc corpus staged by `knowledge-base-input.ts`.

## Conventions

- **Tab indentation, line width 100, double quotes, trailing commas all** (Biome). `biome.json` ignores `skills/`, `agents/`, `prompts/`, and all `*.md`.
- TypeScript is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`; Biome enforces `useImportType: error`. Use `import type { … }` for type-only imports.
- Anything that touches the file system in `<cwd>/piolium/` should respect the snake_case state schema and use the existing helpers in `audit-state.ts` rather than re-rolling JSON I/O.
- New session flags should be added to `FLAG_ENV_MAPPINGS` in `index.ts` (flag → env var → description) so they're auto-registered and auto-mirrored to `process.env`.
- The `--plm-*` flag prefix and `PIOLIUM_*` env prefix are user-visible; renaming either is a breaking change.

## Security note (from README)

Pi packages execute arbitrary code: extensions run TypeScript, skills can instruct the model to run any shell command, and the bundled audit agents declare `bash`, `write`, and `edit` tools. Treat this package as trusted-local tooling. Don't run Piolium against untrusted repositories without sandboxing the working directory.
