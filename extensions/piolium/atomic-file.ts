/**
 * Crash-safe file writes for the audit directory.
 *
 * Both helpers here existed in three near-identical copies (`audit-state.ts`,
 * `longshot.ts`, `attack-pattern-registry.ts`) before being promoted. The
 * copies had already drifted — one backup path used an ISO stamp with a
 * collision counter, another epoch millis with neither — which is exactly the
 * failure a shared helper prevents.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write via temp file + rename, which is atomic on POSIX: a crash mid-write
 * leaves the previous file intact rather than a half-written one. Creates the
 * parent directory if needed.
 */
export function writeFileAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, content);
	renameSync(tmp, path);
}

/**
 * Move a corrupt file aside to `<path>.corrupt-<timestamp>` so a subsequent
 * write doesn't destroy whatever it held. Best-effort: if the rename fails the
 * file is left in place rather than risking its loss.
 *
 * The counter suffix matters — two repairs inside the same second would
 * otherwise overwrite the first backup, losing the very thing being preserved.
 */
export function backupCorruptFile(path: string): void {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	let backup = `${path}.corrupt-${stamp}`;
	for (let n = 1; existsSync(backup); n++) backup = `${path}.corrupt-${stamp}-${n}`;
	try {
		renameSync(path, backup);
	} catch {
		// Leave the file in place; overwriting it later is still better than
		// destroying it now.
	}
}
