// Posting timeline for the Today page: when a role was posted, when it closes,
// and whether the employer reviews applications on a rolling basis.
//
// There is no "closing date" column in the tracker, and the core does not
// record one. The dates already exist in the user's own files, though, in two
// places:
//   1. the tracker's Notes cell — the evaluator writes "posted: 2026-09-15"
//      and often "closes 18 Oct 2026" there;
//   2. the report's archived JD — "Placed On: 2nd October 2026 Closes: 18th
//      October 2026", "Closing date 02-Nov-2026", "Date posted 06 October 2026".
// This module READS them; it never writes a date back. Notes win over the
// report because they are the evaluator's curated summary, and the report's
// archived JD wins over its analysis prose.
//
// Plain .mjs so `node --test` exercises it directly (web/AGENTS.md: a rule you
// want to assert does not live in a component).

import { canonStatus } from "../status-alias.mjs";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// Order matters: the most specific shapes first, so "2026-10-18" is never read
// as a day-month pair and "02-Nov-2026" is not cut short.
const DATE_PATTERNS = [
  { re: /(\d{4})-(\d{2})-(\d{2})/, parts: (m) => [m[1], m[2], m[3]] },
  { re: new RegExp(`(\\d{1,2})-${MONTH_RE}-(\\d{4})`, "i"), parts: (m) => [m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]] },
  {
    re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?`, "i"),
    parts: (m) => [m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]],
  },
  {
    re: new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i"),
    parts: (m) => [m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]],
  },
  // UK day-first slashes. Only reached right after a closing/posted keyword,
  // never in free text, so a visa expiry like "31/8/2027" elsewhere is ignored.
  { re: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, parts: (m) => [m[3], m[2], m[1]] },
];

const pad = (n) => String(n).padStart(2, "0");

/** The LOCAL calendar day as YYYY-MM-DD. Not toISOString(): that is the UTC
 *  day, which runs a day ahead in the evening west of Greenwich (#3070). */
export function localIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" → epoch day (UTC), or NaN. */
export function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
}

/**
 * Parse the FIRST date that starts within `maxOffset` chars of `text`.
 * A missing year is inferred from `refIso` (the report/tracker date): a
 * posting evaluated in December that "closes 5 Jan" closes NEXT January.
 *
 * @param {string} text
 * @param {string} [refIso]
 * @param {number} [maxOffset]
 * @returns {string|null} YYYY-MM-DD
 */
export function parseLooseDate(text, refIso, maxOffset = 24) {
  const s = String(text ?? "");
  let best = null;
  for (const { re, parts } of DATE_PATTERNS) {
    const m = re.exec(s);
    if (!m || m.index > maxOffset) continue;
    if (best && best.index <= m.index) continue;
    best = { index: m.index, parts: parts(m) };
  }
  if (!best) return null;
  let [y, mo, d] = best.parts.map((v) => (v === undefined ? undefined : Number(v)));
  if (!mo || !d || mo > 12 || d > 31) return null;
  if (!y) {
    const ref = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(refIso ?? ""));
    if (!ref) return null;
    y = Number(ref[1]);
    // More than ~4 months before the reference date → it means next year.
    if (dayNumber(`${y}-${pad(mo)}-${pad(d)}`) < dayNumber(refIso) - 120) y += 1;
  }
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  // Reject impossible days (31 Feb) instead of letting Date roll them over.
  const back = new Date(Date.UTC(y, mo - 1, d));
  if (back.getUTCMonth() !== mo - 1) return null;
  return iso;
}

const CLOSE_KEYWORDS =
  /\b(?:closes|closing date(?: is| of)?|closing|application deadline|deadline(?: for applications)?|apply by|applications close|close date|end date|expires on|expiry date)\b[\s:(*-]*/gi;
const POSTED_KEYWORDS = /\b(?:posted(?: date)?(?: is| of| on)?|date posted|placed on|posting date|published(?: on)?|date advertised)\b[\s:(*-]*/gi;
const ROLLING_RE =
  /\brolling (?:basis|deadline|applications|recruitment|review)\b|\breserve the right to close\b|\bmay close (?:this |the )?(?:vacancy |advert |role |posting )?early\b|\bclose (?:the|this) (?:vacancy|advert|role|posting) early\b|\bbefore the (?:advertised )?closing date if\b/i;
const CLOSED_RE =
  /\bposting closed\b|\bclosing date (?:has )?passed\b|\badvert has expired\b|\bno longer accepting applications\b|\bjob (?:is )?(?:closed|expired)\b/i;

function firstKeywordDate(text, keywords, refIso) {
  if (!text) return null;
  keywords.lastIndex = 0;
  let m;
  while ((m = keywords.exec(text))) {
    // "closing the AWS gap" matches the keyword but has no date nearby — skip
    // it and keep looking rather than giving up on the whole text.
    const date = parseLooseDate(text.slice(m.index + m[0].length, m.index + m[0].length + 48), refIso);
    if (date) return date;
  }
  return null;
}

/** The report's archived JD — the employer's own words, so the most reliable. */
function archivedJd(report) {
  const s = String(report ?? "");
  const start = s.search(/^##\s+Job Description/im);
  if (start < 0) return "";
  const rest = s.slice(start + 3);
  const end = rest.search(/^##\s/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Extract the posting timeline for one tracker row.
 *
 * @param {{notes?: string, date?: string}} app  tracker row (date = evaluated on)
 * @param {string|null|undefined} report  the report markdown, when there is one
 * @returns {{posted: string|null, closes: string|null, rolling: boolean, closedSignal: boolean}}
 */
export function extractPostingTimeline(app, report) {
  const notes = String(app?.notes ?? "");
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(app?.date ?? "") ? app.date : undefined;
  const jd = archivedJd(report);
  const prose = String(report ?? "");
  const pick = (keywords) =>
    firstKeywordDate(notes, keywords, ref) ?? firstKeywordDate(jd, keywords, ref) ?? firstKeywordDate(prose, keywords, ref);
  let posted = pick(POSTED_KEYWORDS);
  const closes = pick(CLOSE_KEYWORDS);
  // A "posted" date after the close date is a misread (usually a page footer
  // timestamp); drop it rather than draw an impossible timeline.
  if (posted && closes && dayNumber(posted) > dayNumber(closes)) posted = null;
  return {
    posted,
    closes,
    rolling: ROLLING_RE.test(notes) || ROLLING_RE.test(jd),
    closedSignal: CLOSED_RE.test(notes),
  };
}

/**
 * Where a role sits relative to today.
 *   closed  — past its closing date, or the tracker says the posting closed
 *   today / soon (≤3 days) / week (≤7) / later — has a closing date ahead
 *   rolling — no fixed date; reviewed as they arrive (apply early)
 *   open    — no date found anywhere
 *
 * @param {{posted: string|null, closes: string|null, rolling: boolean, closedSignal: boolean}} t
 * @param {string} todayIso  the user's LOCAL date — the server's UTC date is a day off in the evening
 */
export function deadlineState(t, todayIso) {
  const today = dayNumber(todayIso);
  const daysLeft = t.closes ? dayNumber(t.closes) - today : null;
  const postedDaysAgo = t.posted ? today - dayNumber(t.posted) : null;
  let urgency;
  if (t.closedSignal || (daysLeft !== null && daysLeft < 0)) urgency = "closed";
  else if (daysLeft === 0) urgency = "today";
  else if (daysLeft !== null && daysLeft <= 3) urgency = "soon";
  else if (daysLeft !== null && daysLeft <= 7) urgency = "week";
  else if (daysLeft !== null) urgency = "later";
  else if (t.rolling) urgency = "rolling";
  else urgency = "open";
  // How far through its advertised window the posting is (0..1), for the bar.
  let progress = null;
  if (t.posted && t.closes) {
    const span = dayNumber(t.closes) - dayNumber(t.posted);
    if (span > 0) progress = Math.min(1, Math.max(0, (today - dayNumber(t.posted)) / span));
  }
  return { daysLeft, postedDaysAgo, urgency, progress };
}

const URGENCY_ORDER = { today: 0, soon: 1, week: 2, later: 3, rolling: 4, open: 5, closed: 6 };

/**
 * Sort: what closes first leads; undated roles follow (rolling first — those
 * fill as applications arrive), then closed ones last, as a warning list.
 * Within a bucket, the stronger score leads.
 *
 * @template T
 * @param {(T & {deadline: {urgency: string, daysLeft: number|null}, score?: string})[]} rows
 * @param {(score: string) => number} scoreOf
 */
export function sortByDeadline(rows, scoreOf) {
  const rank = (s) => {
    const n = scoreOf(s ?? "");
    return Number.isNaN(n) ? -1 : n;
  };
  return [...rows].sort((a, b) => {
    const u = URGENCY_ORDER[a.deadline.urgency] - URGENCY_ORDER[b.deadline.urgency];
    if (u !== 0) return u;
    if (a.deadline.daysLeft !== null && b.deadline.daysLeft !== null && a.deadline.daysLeft !== b.deadline.daysLeft) {
      return a.deadline.daysLeft - b.deadline.daysLeft;
    }
    return rank(b.score) - rank(a.score);
  });
}

/**
 * @typedef {{n: string, company: string, via: string, role: string, score: string,
 *   posted: string|null, closes: string|null, rolling: boolean,
 *   deadline: {daysLeft: number|null, postedDaysAgo: number|null, urgency: string, progress: number|null}}} DeadlineRow
 */

/**
 * The Today page's deadline queue: every scored-but-undecided role (the ones
 * a closing date still matters for — once Applied, the clock has stopped),
 * with its posting timeline, soonest-closing first. Only the fields the
 * card renders cross the server/client boundary.
 *
 * @param {{n: string, date?: string, company?: string, via?: string, role?: string, score?: string, status?: string, notes?: string}[]} apps
 * @param {(n: string) => string|null|undefined} reportOf  report markdown by tracker #
 * @param {string} todayIso
 * @param {(score: string) => number} scoreOf
 * @returns {DeadlineRow[]}
 */
export function buildDeadlineQueue(apps, reportOf, todayIso, scoreOf) {
  const rows = apps
    .filter((a) => canonStatus(String(a.status ?? "").replace(/\s+\d{4}-\d{2}-\d{2}\s*$/, "").trim()) === "EVALUATED")
    .map((a) => {
      const t = extractPostingTimeline(a, reportOf(a.n));
      return {
        n: a.n,
        company: a.company ?? "",
        via: a.via ?? "",
        role: a.role ?? "",
        score: a.score ?? "",
        posted: t.posted,
        closes: t.closes,
        rolling: t.rolling,
        deadline: deadlineState(t, todayIso),
      };
    });
  return sortByDeadline(rows, scoreOf);
}

/** "in 3 days", "tomorrow", "today", "2 days ago". */
export function relativeDays(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
