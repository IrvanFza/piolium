<p align="center">
  <a href="https://github.com/vigolium"><img alt="Vigolium" src="https://avatars.githubusercontent.com/u/266502139?s=200&v=4" height="140" /></a>
  <br />
  <strong>Vigolium - high-fidelity vulnerability scanner with native scan precision and agentic scan intelligence.</strong>
  <br />
  <p align="center"><a href="https://www.vigolium.com">www.vigolium.com</a> - <a href="https://docs.vigolium.com">docs.vigolium.com</a></p>
</p>

![Piolium Audit](https://github.com/vigolium/docs/blob/main/images/audit/vigolium-audit-with-piolium.png?raw=true)

# Piolium

Piolium is [Vigolium](https://github.com/vigolium/vigolium)'s Pi-native repository security audit agent. It runs multi-phase source audits with specialist sub-agents, resumable state, controlled concurrency, PoC generation, and final reporting.

Piolium is packaged as a Pi extension. Once installed, it registers `/piolium-*` slash commands inside Pi sessions and also provides a standalone `piolium` launcher when installed through the quick installer.

> [!WARNING]
> Full audit runs can take hours. Run Piolium only against repositories you trust or inside a sandboxed working directory.

## Install

Piolium is a Pi package, so install [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) first if you don't have it:

```bash
bun add -g @earendil-works/pi-coding-agent
```

Recommended — install Piolium into your Pi from npm:

```bash
pi install npm:@vigolium/piolium
```

This registers the `/piolium-*` slash commands in your Pi sessions. Run them with `pi -p "/piolium-balanced --fresh"` or inside an interactive `pi` session.

### From source (development)

For development from this checkout, you need Pi (the `pi` CLI) and Bun ≥ 1.1.0 already on your PATH:

```bash
bun install
pi install ./   # in-place dev install; edits in this checkout apply immediately
```

## Quick Start

Run an audit with a one-shot command:

```bash
pi -p '/piolium-deep'
```

Or start an interactive `pi` session and type a command such as:

```text
/piolium-deep ../target-repo --fresh
/piolium-status
```

## Commands

| Command | Purpose |
| --- | --- |
| `/piolium-help` | Show commands, flags, and examples. |
| `/piolium-status [path]` | Show audit progress. |
| `/piolium-lite [path] [--fresh]` | Quick recon, secrets scan, and fast SAST. |
| `/piolium-balanced [path] [--fresh]` | Default audit with PoCs and report. |
| `/piolium-deep [path] [--fresh] [P1..P17]` | Full deep audit, optionally rerunning selected phases. |
| `/piolium-confirm [path] [--fresh] [https://target]` | Confirm existing findings live or with tests. |
| `/piolium-diff [path] [--since=<sha>]` | Scan changed files since an audited commit. |
| `/piolium-revisit [path] [--fresh]` | Anti-anchored second pass over an audit. |
| `/piolium-merge [path] --dir=<tree> --dir=<tree>` | Merge and dedupe result trees. |
| `/piolium-export [path] [--format=json\|md-dir]` | Export filtered findings with owner labels. |
| `/piolium-learn [path] [--apply]` | Suggest or apply project-local candidate matchers. |
| `/piolium-smoke [path] [prompt]` | Verify runner/provider wiring. |
| `/piolium-longshot [path] [--fresh] [--limit=N]` | File-by-file vulnerability hunt. |

Most commands accept an optional target directory as the first argument.

## Custom instructions

Every `/piolium-*` command accepts custom instructions that reach all sub-agents in every phase — use them to set the reporting language, describe the deployment environment, or steer emphasis:

```text
/piolium-deep ../target-repo --instructions="Write all reports in Chinese"
/piolium-deep ../target-repo --instructions="Intranet-only service behind SSO; weight the threat model for an authenticated internal attacker"
```

Three ways to supply them, highest precedence first:

| Source | How |
| --- | --- |
| Inline | `--instructions="<text>"` per command, or `pi --plm-instructions "<text>"` for the session |
| Named file | `--instructions-file=<path>`, or `pi --plm-instructions-file <path>` |
| Repo default | Check `piolium/INSTRUCTIONS.md` into the target repo — picked up automatically |

Instructions steer language, format, emphasis, and environment assumptions. They do not relax the audit: every phase still runs, findings are still verified against source, and none are omitted or downgraded because of an instruction.

For authoritative project context — trust boundaries, auth primitives, known false-positive sources — use `piolium/KNOWLEDGE-BASE.md` instead; it is inlined into the knowledge base rather than treated as a directive.

## Providers

Piolium runs on whatever provider your Pi session is configured for. It also bundles an `anthropic-vertex` provider for running Claude through Google Vertex AI, registered only when Vertex is configured — any `GOOGLE_CLOUD_*` / `ANTHROPIC_VERTEX_PROJECT_ID` env var enables it, or set `PIOLIUM_VERTEX=1` to force it on (`PIOLIUM_VERTEX=0` to hide it). See [HACKING.md](HACKING.md#claude-on-vertex) for details.

## Deep mode phases

`/piolium-deep` runs 17 phases (`P1`–`P17`) in five stages. Pass phase ids to rerun only those (e.g. `/piolium-deep . P4 P10`):

- **Recon & modeling** — `P1` intelligence & dependency risk, `P2` patch history & bypass review, `P3` architecture & threat model.
- **Analysis** — `P4` static analysis & triage, `P5` authorization & access control, `P6` state machine & concurrency, `P7` spec/parser/framework-contract gaps, `P8` manual attack-surface probe, `P9` cross-service data flow.
- **Adversarial validation** — `P10` adversarial review chamber, `P11` false-positive verification, `P12` variant search.
- **PoC & reporting** — `P13` proof-of-concept construction, `P14` per-finding report drafting, `P15` final report assembly, `P16` finding verification.
- **Cleanup** — `P17` removes transient workspaces and tool artifacts.

See [docs/phase-reference.md](docs/phase-reference.md) for per-phase behavior and outputs.

## Output

All audit artifacts are written under a `piolium/` directory in the target repository:

```text
piolium/
  audit-state.json          # resumable run state and per-phase status
  attack-surface/           # durable knowledge base: recon, SAST, probes, threat model
  findings-draft/           # candidate findings, named by the phase that produced them
  findings/<id>-<slug>/      # final findings: draft.md, report.md, poc.*, evidence/
  final-audit-report.md     # consolidated report across finalized findings
  tmp/piolium/runs/<id>/     # per-agent transcripts (removed by cleanup phases)
```

Not every command writes every path — Lite skips the deep workspaces, while Deep adds the full `attack-surface/` corpus plus `variant-summary.md` and, when findings confirm, `confirmation-report.md`. For a finished audit, start with `final-audit-report.md`, then each `findings/<id>-<slug>/report.md`.

Useful references:

- [HACKING.md](HACKING.md) - technical setup, flags, retries, release, and development notes.
- [docs/phase-reference.md](docs/phase-reference.md) - phase behavior and outputs.
- [docs/output-structure.md](docs/output-structure.md) - output directory layout.

## Security Note

Pi packages execute code locally. Extensions run TypeScript, skills can ask the model to run shell commands, and Piolium's audit agents use filesystem and shell tooling. Treat Piolium as trusted local tooling and sandbox untrusted targets.

## License

Piolium is made with ♥ by [@j3ssie](https://github.com/j3ssie) and it is released under the MIT license.
