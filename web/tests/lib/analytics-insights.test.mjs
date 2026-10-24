// Run:  node --test tests/lib/analytics-insights.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyActivity, conversion, trackOf, trackBreakdown, skipReasons, medianDaysToCatch, insights } from "../../src/lib/analytics-insights.mjs";

const scoreOf = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
};

test("weekly buckets are Monday-start and oldest first", () => {
  // 2026-10-15 is a Thursday → this week starts Monday 2026-10-12.
  const w = weeklyActivity([{ date: "2026-10-12" }, { date: "2026-10-11" }, { date: "2026-10-15" }, { date: "bad" }], "2026-10-15", 2);
  assert.deepEqual(w, [{ start: "2026-10-05", count: 1 }, { start: "2026-10-12", count: 2 }]);
});

test("conversion is cumulative: an interview counts as applied and responded", () => {
  const c = conversion(
    [{ status: "Interview", score: "4.2/5" }, { status: "Applied", score: "3.9/5" }, { status: "Rejected" }, { status: "Evaluated" }, { status: "SKIP" }],
    scoreOf,
  );
  assert.equal(c.applied, 3);
  assert.equal(c.responded, 1);
  assert.equal(c.responseRate, 33);
  assert.equal(c.pending, 1);
  assert.equal(c.strong, 1);
});

test("tracks are read from the notes tag", () => {
  assert.equal(trackOf("[Track: AI Engineer] blah"), "AI Engineer");
  assert.equal(trackOf("no tag"), null);
  const t = trackBreakdown(
    [{ notes: "[Track: A]", score: "4/5", status: "Evaluated" }, { notes: "[Track: A]", score: "2/5" }, { notes: "", score: "3/5" }],
    scoreOf,
  );
  assert.deepEqual(t[0], { track: "A", count: 2, strong: 1, open: 1, avg: 3 });
  assert.equal(t[1].track, "Untagged");
});

test("each skipped role counts once, under its hardest blocker", () => {
  const r = skipReasons([
    { status: "SKIP", notes: "senior role and JD says we cannot sponsor visas" },
    { status: "Discarded", notes: "requires a PhD" },
    { status: "Evaluated", notes: "cannot sponsor" },
    { status: "SKIP", notes: "just not interesting" },
  ]);
  assert.deepEqual(r.map((x) => [x.key, x.count]), [["sponsorship", 1], ["phd", 1], ["other", 1]]);
});

test("median catch time ignores stale evergreen postings", () => {
  assert.equal(medianDaysToCatch([
    { posted: "2026-10-01", evaluated: "2026-10-03" },
    { posted: "2026-10-01", evaluated: "2026-10-11" },
    { posted: "2024-01-01", evaluated: "2026-10-11" },
    { posted: null, evaluated: "2026-10-11" },
  ]), 6);
  assert.equal(medianDaysToCatch([]), null);
});

test("insights lead with what to act on and skip thin evidence", () => {
  const conv = { total: 10, applied: 0, pending: 4, responseRate: null };
  const out = insights({ conv, tracks: [], reasons: [{ key: "phd", label: "Needs a PhD", count: 2 }], catchDays: null, closingSoon: 2 });
  assert.equal(out[0].tone, "action");
  assert.match(out[0].text, /2 undecided roles close/);
  assert.ok(!out.some((o) => /PhD/.test(o.text)), "2 skips is too thin to call a pattern");
});
