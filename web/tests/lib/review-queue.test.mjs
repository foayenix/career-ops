// Tests for the Review page's queue order and the auto-advance after a decision.
//
// Run:  node --test tests/lib/review-queue.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewQueue, nextAfterRemoval } from "../../src/lib/review-queue.mjs";

const scoreOf = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : NaN;
};

const row = (n, date, score, status = "Evaluated") => ({ n, date, score, status });

test("only undecided rows, best score first, newest breaks ties", () => {
  const rows = [
    row("1", "2026-10-01", "3.5/5"),
    row("2", "2026-10-03", "4.2/5"),
    row("3", "2026-10-02", "4.2/5"),
    row("4", "2026-10-04", "4.8/5", "SKIP"),
    row("5", "2026-10-05", "4.9/5", "Discarded"),
    row("6", "2026-10-06", ""),
  ];
  assert.deepEqual(reviewQueue(rows, scoreOf).map((r) => r.n), ["2", "3", "1", "6"]);
});

test("is not capped at the Today page's six cards", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(String(i), "2026-10-01", "4.0/5"));
  assert.equal(reviewQueue(rows, scoreOf).length, 20);
});

test("advance lands on the row that took the removed one's place", () => {
  assert.equal(nextAfterRemoval(["a", "b", "c"], "a"), "b");
  assert.equal(nextAfterRemoval(["a", "b", "c"], "b"), "c");
});

test("removing the last row steps back; emptying the queue gives null", () => {
  assert.equal(nextAfterRemoval(["a", "b", "c"], "c"), "b");
  assert.equal(nextAfterRemoval(["a"], "a"), null);
});

test("an id already gone falls back to the first row", () => {
  assert.equal(nextAfterRemoval(["a", "b"], "z"), "a");
});
