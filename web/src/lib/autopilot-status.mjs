// Read-only view over the personal autopilot (local/autopilot.mjs): which step of
// the latest run is going, what each finished step reported, and what it queued.
// The autopilot writes data/autopilot/YYYY-MM-DD.log; this module only parses it.
//
// Log shape (one run per "=== autopilot" header, several runs per file):
//   [18:18:10] === autopilot 2026-10-12 (evening) ===
//   [18:18:10] ▶ scan: node scan.mjs --quiet
//       <step output, indented, appended when the step exits>
//   [18:40:02] ✓ scan (exit 0)            or  ✗ scan (exit 1)
//   [..] ✗ triage skipped: Ollama is not running
//   [..] · jev gate off (no TYPESAFE_API_KEY); ...
//   [..]   queued jev 4.2/5 Acme — Data Analyst
//   [..] daily cap reached (10/10)
//   [..] === done ===                      or  ✗ fatal: ...

import fs from "node:fs";
import path from "node:path";

export const STEPS = [
  { key: "scan", label: "Scan employers" },
  { key: "websearch", label: "Web search" },
  { key: "triage", label: "Title triage (Ollama)" },
  { key: "jev gate", label: "Jev gate (full JD)" },
  { key: "evaluate", label: "Claude evaluation" },
];
const STEP_KEYS = STEPS.map((s) => s.key).join("|");
const HEADER_RE = /^\[(\d\d:\d\d:\d\d)\] === autopilot (\S+) \((\w+)\) ===$/;
const LINE_RE = /^\[(\d\d:\d\d:\d\d)\] (.*)$/;
const START_RE = new RegExp(`^▶ (${STEP_KEYS}):`);
const END_RE = new RegExp(`^([✓✗]) (${STEP_KEYS}) \\(exit (.+)\\)$`);

/**
 * Parse the LAST run in one autopilot log file.
 * @param {string} text
 * @returns {null | {date: string, slot: string, startedAt: string, endedAt: string | null,
 *   finished: boolean, fatal: string | null,
 *   steps: {key: string, label: string, state: "pending"|"running"|"done"|"failed"|"skipped", startedAt: string|null, endedAt: string|null, detail: string}[],
 *   queued: string[], evaluations: {offer: string, url: string, outcome: "running"|"completed"|"failed", score: string|null, report: string|null}[]}}
 */
export function parseLatestRun(text) {
  const lines = String(text ?? "").split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADER_RE.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  const [, startedAt, date, slot] = lines[start].match(HEADER_RE);
  const steps = STEPS.map((s) => ({ ...s, state: "pending", startedAt: null, endedAt: null, detail: "" }));
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const run = { date, slot, startedAt, endedAt: null, finished: false, fatal: null, steps, queued: [], evaluations: [] };
  let current = null;

  for (const line of lines.slice(start + 1)) {
    const m = line.match(LINE_RE);
    if (!m) {
      if (current) readOutput(run, current, line.trim());
      continue;
    }
    const [, time, msg] = m;
    let s;
    if ((s = msg.match(START_RE))) {
      current = byKey.get(s[1]);
      Object.assign(current, { state: "running", startedAt: time });
    } else if ((s = msg.match(END_RE))) {
      const step = byKey.get(s[2]);
      Object.assign(step, { state: s[1] === "✓" ? "done" : "failed", endedAt: time });
      if (s[1] === "✗" && !step.detail) step.detail = `exit ${s[3]}`;
      current = null;
    } else if (msg.startsWith("✗ triage skipped:")) {
      Object.assign(byKey.get("triage"), { state: "skipped", detail: msg.slice(18).trim() });
    } else if (msg.startsWith("· jev gate off")) {
      Object.assign(byKey.get("jev gate"), { state: "skipped", detail: "off: no TYPESAFE_API_KEY" });
    } else if (msg.trim().startsWith("jev gate failed")) {
      byKey.get("jev gate").detail = "failed; queued on title triage instead";
    } else if (msg.startsWith("  queued ")) {
      run.queued.push(msg.slice(9).trim());
    } else if (msg.startsWith("daily cap reached")) {
      Object.assign(byKey.get("evaluate"), { state: "skipped", detail: msg });
    } else if (msg.trim().startsWith("batch paused")) {
      byKey.get("evaluate").detail = "paused on a Claude usage limit; resumes next run";
    } else if (msg === "=== done ===") {
      Object.assign(run, { finished: true, endedAt: time });
    } else if (msg.startsWith("✗ fatal:")) {
      Object.assign(run, { fatal: msg.slice(8).trim(), endedAt: time });
    }
  }
  // websearch only runs in the morning; a finished run that never started a step skipped it.
  if (run.finished || run.fatal) {
    for (const step of steps) if (step.state === "pending") step.state = "skipped";
  }
  return run;
}

function readOutput(run, step, line) {
  if (!line) return;
  if (step.key === "evaluate") {
    const p = line.match(/^--- Processing offer #(\d+): (\S+)/);
    if (p) { run.evaluations.push({ offer: p[1], url: p[2], outcome: "running", score: null, report: null }); return; }
    const last = run.evaluations.at(-1);
    const c = line.match(/^✅ Completed \(score: ([\d.]+), report: (\d+)\)/);
    if (c && last) Object.assign(last, { outcome: "completed", score: c[1], report: c[2] });
    else if (line.startsWith("❌ Failed") && last) last.outcome = "failed";
    return;
  }
  if (step.key === "jev gate" && line.startsWith("Jev gate (")) step.detail = line.replace(/^Jev gate \([^)]*\):\s*/, "").replace(/\.$/, "");
  else if (step.key === "triage" && line.startsWith("Ranked ")) step.detail = line.replace(/\.$/, "");
  else if (step.key === "triage" && line.startsWith("No unranked")) step.detail = "nothing new to rank";
}

/**
 * Status of the latest autopilot run under `root`, or `{available: false}` when
 * the autopilot is not set up there (no data/autopilot directory).
 */
export function readAutopilotStatus(root) {
  const dir = path.join(root, "data", "autopilot");
  let logs;
  try {
    logs = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
  } catch (err) {
    if (err?.code === "ENOENT") return { available: false };
    throw err;
  }
  if (!logs.length) return { available: true, running: false, run: null };
  const run = parseLatestRun(fs.readFileSync(path.join(dir, logs.at(-1)), "utf-8"));
  const running = fs.existsSync(path.join(dir, ".lock")) && !!run && !run.finished && !run.fatal;
  // A lock-free unfinished run was killed (reboot, launchd timeout): say so, don't spin forever.
  if (run && !running && !run.finished && !run.fatal) {
    for (const step of run.steps) if (step.state === "running") step.state = "failed";
    run.fatal = "interrupted before finishing";
  }
  return { available: true, running, run, jev: jevCounts(path.join(dir, "jev-gate.tsv"), run?.date) };
}

function jevCounts(file, date) {
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  const counts = { pass: 0, fail: 0, review: 0, no_jd: 0 };
  for (const row of text.split("\n").slice(1)) {
    const [d, , verdict] = row.split("\t");
    if (d === date && verdict in counts) counts[verdict] += 1;
  }
  return counts;
}
