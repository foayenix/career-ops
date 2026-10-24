// Run:  node --test tests/lib/autopilot-status.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLatestRun } from "../../src/lib/autopilot-status.mjs";

const finished = `[08:00:01] === autopilot 2026-10-12 (morning) ===
[08:00:01] ▶ scan: node scan.mjs --quiet
    found 3 new
[08:20:00] ✓ scan (exit 0)
[08:20:00] ✗ triage skipped: Ollama is not running
[08:20:00] ▶ jev gate: node local/gate-jev.mjs --limit 40
      pass   4.30 Acme — Data Analyst (fit 4.30)
      Jev gate (jev-latest): 1 pass, 2 fail.
[08:21:00] ✓ jev gate (exit 0)
[08:21:00]   queued jev 4.3/5 Acme — Data Analyst
[08:21:00] ▶ evaluate: bash batch/batch-runner.sh --limit 15
    --- Processing offer #7: https://example.com/a (report 012, attempt 1)
        ✅ Completed (score: 4.1, report: 012)
    --- Processing offer #8: https://example.com/b (report 013, attempt 1)
        ❌ Failed (worker-reported, attempt 1): closed
[08:40:00] ✓ evaluate (exit 0)
[08:40:00] === done ===
`;

test("reads only the last run in a file", () => {
  const run = parseLatestRun(`[07:00:00] === autopilot 2026-10-11 (evening) ===\n[07:00:01] === done ===\n${finished}`);
  assert.equal(run.date, "2026-10-12");
  assert.equal(run.slot, "morning");
});

test("finished run: step states, details, queue and evaluations", () => {
  const run = parseLatestRun(finished);
  assert.equal(run.finished, true);
  assert.equal(run.endedAt, "08:40:00");
  const state = Object.fromEntries(run.steps.map((s) => [s.key, s.state]));
  assert.deepEqual(state, { scan: "done", websearch: "skipped", triage: "skipped", "jev gate": "done", evaluate: "done" });
  assert.equal(run.steps.find((s) => s.key === "triage").detail, "Ollama is not running");
  assert.equal(run.steps.find((s) => s.key === "jev gate").detail, "1 pass, 2 fail");
  assert.deepEqual(run.queued, ["jev 4.3/5 Acme — Data Analyst"]);
  assert.deepEqual(run.evaluations.map((e) => [e.offer, e.outcome, e.score]), [["7", "completed", "4.1"], ["8", "failed", null]]);
});

test("run in progress keeps later steps pending", () => {
  const run = parseLatestRun("[18:18:10] === autopilot 2026-10-12 (evening) ===\n[18:18:10] ▶ scan: node scan.mjs --quiet\n");
  assert.equal(run.finished, false);
  assert.equal(run.steps[0].state, "running");
  assert.equal(run.steps[0].startedAt, "18:18:10");
  assert.ok(run.steps.slice(1).every((s) => s.state === "pending"));
});

test("a failed step reports its exit", () => {
  const run = parseLatestRun("[08:04:12] === autopilot 2026-10-11 (morning) ===\n[08:04:12] ▶ scan: x\n[09:16:06] ✗ scan (exit SIGTERM)\n");
  assert.equal(run.steps[0].state, "failed");
  assert.equal(run.steps[0].detail, "exit SIGTERM");
});

test("no run header → null", () => {
  assert.equal(parseLatestRun(""), null);
});
