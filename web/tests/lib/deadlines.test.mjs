// Posting timeline extraction for the Today page's Deadlines board.
// Run:  node --test tests/lib/deadlines.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLooseDate, extractPostingTimeline, deadlineState, sortByDeadline, buildDeadlineQueue, localIsoDate, relativeDays,
} from "../../src/lib/home/deadlines.mjs";

const scoreOf = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
};

test("parses the date shapes real JDs and tracker notes use", () => {
  assert.equal(parseLooseDate("2026-10-18"), "2026-10-18");
  assert.equal(parseLooseDate("18th October 2026 Job Ref"), "2026-10-18");
  assert.equal(parseLooseDate("02-Nov-2026."), "2026-11-02");
  assert.equal(parseLooseDate("Friday 09 October 2026"), "2026-10-09");
  assert.equal(parseLooseDate("October 5, 2026"), "2026-10-05");
  assert.equal(parseLooseDate("31/8/2027"), "2027-08-31");
});

test("a missing year comes from the reference date, rolling into next year across New Year", () => {
  assert.equal(parseLooseDate("8 Oct 10pm", "2026-10-07"), "2026-10-08");
  assert.equal(parseLooseDate("5 Jan", "2026-12-20"), "2027-01-05");
  assert.equal(parseLooseDate("8 Oct"), null, "no reference → no guess");
});

test("impossible and far-away dates are rejected", () => {
  assert.equal(parseLooseDate("31 February 2026"), null);
  assert.equal(parseLooseDate("the role, expected around 18 October 2026"), null, "date must sit right after the keyword");
});

test("notes win over the report, and the archived JD wins over analysis prose", () => {
  const report = [
    "# Evaluation", "The closing date (9 Oct 2026) has passed in an older advert.",
    "## Job Description (archived verbatim)", "Placed On: 2nd October 2026 Closes: 18th October 2026 Job Ref: X",
    "## Machine Summary",
  ].join("\n");
  assert.deepEqual(extractPostingTimeline({ notes: "", date: "2026-10-08" }, report), {
    posted: "2026-10-02", closes: "2026-10-18", rolling: false, closedSignal: false,
  });
  const t = extractPostingTimeline({ notes: "req 1; posted: 2026-10-01; closes 20 Oct 2026", date: "2026-10-08" }, report);
  assert.equal(t.closes, "2026-10-20");
  assert.equal(t.posted, "2026-10-01");
});

test("a keyword without a date nearby does not stop the search", () => {
  const t = extractPostingTimeline({ notes: "closing the AWS gap first; closes 1 Nov 2026", date: "2026-10-14" }, null);
  assert.equal(t.closes, "2026-11-01");
});

test("rolling review and an explicit closed note are detected", () => {
  assert.equal(extractPostingTimeline({ notes: "", date: "2026-10-14" }, "## Job Description\nWe review applications on a rolling basis.").rolling, true);
  assert.equal(extractPostingTimeline({ notes: "Closes | 1 Nov (may close early)", date: "2026-10-14" }, null).rolling, true);
  assert.equal(extractPostingTimeline({ notes: "posting closed: Greenhouse 404" }, null).closedSignal, true);
});

test("urgency buckets", () => {
  const t = (closes, extra = {}) => ({ posted: null, closes, rolling: false, closedSignal: false, ...extra });
  const today = "2026-10-15";
  assert.equal(deadlineState(t("2026-10-14"), today).urgency, "closed");
  assert.equal(deadlineState(t("2026-10-15"), today).urgency, "today");
  assert.equal(deadlineState(t("2026-10-18"), today).urgency, "soon");
  assert.equal(deadlineState(t("2026-10-22"), today).urgency, "week");
  assert.equal(deadlineState(t("2026-10-23"), today).urgency, "later");
  assert.equal(deadlineState(t(null, { rolling: true }), today).urgency, "rolling");
  assert.equal(deadlineState(t(null), today).urgency, "open");
  assert.equal(deadlineState(t("2026-12-01", { closedSignal: true }), today).urgency, "closed");
});

test("progress runs 0 → 1 across the posted→closes window", () => {
  const s = deadlineState({ posted: "2026-10-01", closes: "2026-10-21", rolling: false, closedSignal: false }, "2026-10-11");
  assert.equal(s.progress, 0.5);
  assert.equal(s.postedDaysAgo, 10);
  assert.equal(s.daysLeft, 10);
});

test("soonest closing first, undated after, closed last; score breaks ties", () => {
  const row = (n, urgency, daysLeft, score = "3.0/5") => ({ n, score, deadline: { urgency, daysLeft } });
  const sorted = sortByDeadline(
    [row("closed", "closed", -2), row("open", "open", null), row("later", "later", 20), row("soon", "soon", 2),
     row("rollLow", "rolling", null, "3.0/5"), row("rollHigh", "rolling", null, "4.5/5"), row("today", "today", 0)],
    scoreOf,
  );
  assert.deepEqual(sorted.map((r) => r.n), ["today", "soon", "later", "rollHigh", "rollLow", "open", "closed"]);
});

test("the queue holds only undecided roles and asks for each report once", () => {
  const asked = [];
  const rows = buildDeadlineQueue(
    [
      { n: "1", status: "Evaluated", notes: "closes 18 Oct 2026", date: "2026-10-10", company: "A", role: "R", score: "4/5" },
      { n: "2", status: "Applied", notes: "closes 16 Oct 2026", date: "2026-10-10" },
      { n: "3", status: "Evaluated 2026-10-10", notes: "", date: "2026-10-10" },
    ],
    (n) => (asked.push(n), null),
    "2026-10-15",
    scoreOf,
  );
  assert.deepEqual(rows.map((r) => r.n), ["1", "3"]);
  assert.deepEqual(asked.sort(), ["1", "3"]);
  assert.equal(rows[0].deadline.urgency, "soon");
});

test("helpers", () => {
  assert.equal(localIsoDate(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
  assert.equal(relativeDays(1), "tomorrow");
  assert.equal(relativeDays(-3), "3 days ago");
});
