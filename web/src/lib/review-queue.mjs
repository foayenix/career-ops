import { pickAwaitingDecision } from "./home/awaiting.mjs";

/**
 * The Review page's queue: every scored-but-undecided application, best score
 * first, newest breaking ties.
 *
 * "Undecided" is pickAwaitingDecision's definition (canonStatus === EVALUATED,
 * date suffix tolerated) — reused rather than restated so Today and Review can
 * never disagree about which roles still need a decision. Only the ORDER
 * differs: Today is a recency feed, Review is a work queue, and a work queue
 * should put the strongest opportunity in front of you first.
 *
 * Plain .mjs so `node --test` imports it with no build step.
 *
 * @template {{date?: string, score?: string, status?: string}} T
 * @param {T[]} applications
 * @param {(score: string) => number} scoreOf  parser returning NaN when absent
 * @returns {T[]}
 */
export function reviewQueue(applications, scoreOf) {
  const rank = (s) => {
    const n = scoreOf(s ?? "");
    return Number.isNaN(n) ? -1 : n;
  };
  return pickAwaitingDecision(applications, scoreOf, Infinity).sort((a, b) => {
    const byScore = rank(b.score) - rank(a.score);
    if (byScore !== 0) return byScore;
    return (b.date || "").localeCompare(a.date || "");
  });
}

/**
 * Which id to show after `id` leaves the queue: the one that took its place,
 * or the new last one when it was at the end. null when the queue empties.
 * An id that is not in the list (already gone) falls back to the first.
 *
 * @param {string[]} ids  the queue BEFORE removal
 * @param {string} id
 * @returns {string | null}
 */
export function nextAfterRemoval(ids, id) {
  const i = ids.indexOf(id);
  const rest = ids.filter((x) => x !== id);
  if (rest.length === 0) return null;
  if (i === -1) return rest[0];
  return rest[Math.min(i, rest.length - 1)];
}
