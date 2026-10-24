// Derived insight for the Analytics page: activity over time, conversion
// between stages, how each target track performs, and the recurring reasons
// roles get skipped. Pure functions over tracker rows — no I/O — so the
// numbers the page shows are the numbers `node --test` asserts.

import { canonStatus } from "./status-alias.mjs";
import { dayNumber } from "./home/deadlines.mjs";

const baseStatus = (s) => String(s ?? "").replace(/\s+\d{4}-\d{2}-\d{2}\s*$/, "").trim();
const canon = (s) => canonStatus(baseStatus(s));

// Stage reached, cumulatively: an Interview proves the application was sent.
const REACHED = {
  APPLIED: ["APPLIED", "RESPONDED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"],
  RESPONDED: ["RESPONDED", "INTERVIEW", "OFFER", "HIRED"],
  INTERVIEW: ["INTERVIEW", "OFFER", "HIRED"],
};

/**
 * Evaluations per week for the last `weeks` weeks (Monday-start), oldest first.
 * @param {{date?: string}[]} apps
 * @param {string} todayIso
 * @param {number} [weeks]
 * @returns {{start: string, count: number}[]}
 */
export function weeklyActivity(apps, todayIso, weeks = 8) {
  const today = dayNumber(todayIso);
  // Epoch day 0 (1970-01-01) was a Thursday → Monday offset is +3.
  const thisMonday = today - ((today + 3) % 7);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisMonday - i * 7;
    const iso = new Date(start * 86_400_000).toISOString().slice(0, 10);
    out.push({ start: iso, count: 0, _s: start });
  }
  for (const a of apps) {
    const d = dayNumber(a.date);
    if (Number.isNaN(d)) continue;
    const bucket = out.find((w) => d >= w._s && d < w._s + 7);
    if (bucket) bucket.count++;
  }
  return out.map(({ start, count }) => ({ start, count }));
}

/**
 * The funnel as rates a candidate can act on.
 * @param {{status?: string, score?: string}[]} apps
 * @param {(s: string) => number} scoreOf
 */
export function conversion(apps, scoreOf) {
  const statuses = apps.map((a) => canon(a.status));
  const count = (keys) => statuses.filter((s) => keys.includes(s)).length;
  const total = apps.length;
  const pending = count(["EVALUATED"]);
  const applied = count(REACHED.APPLIED);
  const responded = count(REACHED.RESPONDED);
  const interviews = count(REACHED.INTERVIEW);
  const skipped = count(["SKIP", "DISCARDED"]);
  const strong = apps.filter((a) => scoreOf(a.score ?? "") >= 4).length;
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
  return {
    total,
    pending,
    applied,
    responded,
    interviews,
    skipped,
    strong,
    applyRate: pct(applied, total),
    responseRate: pct(responded, applied),
    interviewRate: pct(interviews, applied),
    strongShare: pct(strong, total),
  };
}

/** "[Track: AI Engineer] …" → "AI Engineer"; null when the note carries none. */
export function trackOf(notes) {
  const m = /\[Track:\s*([^\]]+)\]/i.exec(String(notes ?? ""));
  return m ? m[1].trim() : null;
}

/**
 * Per-track volume, average score and strong-fit count, busiest first.
 * @param {{notes?: string, score?: string, status?: string}[]} apps
 * @param {(s: string) => number} scoreOf
 */
export function trackBreakdown(apps, scoreOf) {
  const by = new Map();
  for (const a of apps) {
    const track = trackOf(a.notes) ?? "Untagged";
    const row = by.get(track) ?? { track, count: 0, scored: 0, sum: 0, strong: 0, open: 0 };
    row.count++;
    const s = scoreOf(a.score ?? "");
    if (!Number.isNaN(s)) {
      row.scored++;
      row.sum += s;
      if (s >= 4) row.strong++;
    }
    if (canon(a.status) === "EVALUATED") row.open++;
    by.set(track, row);
  }
  return [...by.values()]
    .map(({ sum, scored, ...r }) => ({ ...r, avg: scored ? sum / scored : null }))
    .sort((a, b) => b.count - a.count || (b.avg ?? 0) - (a.avg ?? 0));
}

// Ordered: the first matching reason is the one a row is counted under, so a
// note that mentions both a hard visa block and seniority counts as the block.
const REASONS = [
  { key: "sponsorship", label: "No visa sponsorship", re: /cannot sponsor|refuses? (?:\w+ )?sponsorship|no sponsorship|not sponsor|sponsorship (?:is )?(?:not|un)available|work auth unconfirmed|E-Verify/i },
  { key: "seniority", label: "Too senior", re: /\bsenior\b|\blead\b|far (?:above|beyond)|\d\+ ?y(?:ea)?rs|mid-level|manager-stage|staff/i },
  { key: "phd", label: "Needs a PhD", re: /\bPhD\b|postdoc/i },
  { key: "pay", label: "Pay below floor", re: /below (?:the )?(?:£?\d+k? )?floor|below .*threshold|under (?:the )?floor/i },
  { key: "location", label: "Location / relocation", re: /not commutable|relocation|far from|on-site in|onsite in/i },
  { key: "domain", label: "Domain / degree mismatch", re: /no (?:CV |domain )?overlap|off-target|degree (?:field )?(?:and .{0,30})?gaps?|cognate degree|non-CS degree|wet-lab|lacks the essential|needs? an? .*degree|needs [A-Z][\w+-]+|gaps? in|neither evidenced|not evidenced|not a target track/i },
  { key: "clearance", label: "Security clearance", re: /\bSC\b|clearance|vetting/i },
  { key: "closed", label: "Posting closed / ineligible", re: /posting closed|closing date passed|not eligible|graduat(?:ing|ed) in/i },
  // Last: a soft risk, counted only when nothing harder explains the skip.
  { key: "sponsor-unclear", label: "Sponsorship unclear", re: /sponsorship (?:unstated|unconfirmed)|confirm sponsorship/i },
];

/**
 * Why roles end up Skipped/Discarded, from the evaluator's notes.
 * @param {{notes?: string, status?: string}[]} apps
 * @returns {{key: string, label: string, count: number}[]}
 */
export function skipReasons(apps) {
  const counts = new Map(REASONS.map((r) => [r.key, 0]));
  let other = 0;
  for (const a of apps) {
    const s = canon(a.status);
    if (s !== "SKIP" && s !== "DISCARDED") continue;
    const hit = REASONS.find((r) => r.re.test(String(a.notes ?? "")));
    if (hit) counts.set(hit.key, counts.get(hit.key) + 1);
    else other++;
  }
  const rows = REASONS.map((r) => ({ key: r.key, label: r.label, count: counts.get(r.key) })).filter((r) => r.count > 0);
  if (other > 0) rows.push({ key: "other", label: "Other / mixed", count: other });
  return rows.sort((a, b) => b.count - a.count);
}

/**
 * How quickly roles are caught: median days from the posting going live to the
 * evaluation. Lower is better — early applicants get read.
 * @param {{posted: string|null, evaluated: string}[]} pairs
 * @returns {number|null}
 */
export function medianDaysToCatch(pairs) {
  const gaps = pairs
    .map((p) => dayNumber(p.evaluated) - dayNumber(p.posted ?? ""))
    // Older than a year is a stale evergreen board listing, not a catch time.
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365)
    .sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

/**
 * Plain-language takeaways, most actionable first. Each is one sentence the
 * candidate can act on; a takeaway whose numbers are too thin to mean anything
 * (fewer than 3 roles behind it) is left out rather than overstated.
 *
 * @param {{conv: ReturnType<typeof conversion>, tracks: ReturnType<typeof trackBreakdown>,
 *   reasons: ReturnType<typeof skipReasons>, catchDays: number|null, closingSoon: number}} s
 * @returns {{tone: "action"|"good"|"info", text: string}[]}
 */
export function insights({ conv, tracks, reasons, catchDays, closingSoon }) {
  const out = [];
  if (closingSoon > 0) {
    out.push({ tone: "action", text: `${closingSoon} undecided role${closingSoon === 1 ? " closes" : "s close"} within 7 days — decide on ${closingSoon === 1 ? "it" : "them"} first.` });
  }
  if (conv.total >= 3 && conv.applied === 0 && conv.pending > 0) {
    out.push({ tone: "action", text: `${conv.total} roles evaluated, none applied to yet. ${conv.pending} still await a decision.` });
  } else if (conv.applied >= 3 && conv.responseRate !== null) {
    out.push({
      tone: conv.responseRate >= 20 ? "good" : "info",
      text: `${conv.responseRate}% of applications got a response${conv.responseRate < 20 ? " — below the ~20% a targeted search usually sees; tighten the fit bar." : "."}`,
    });
  }
  const ranked = tracks.filter((t) => t.track !== "Untagged" && t.avg !== null && t.count >= 3);
  if (ranked.length >= 2) {
    const best = [...ranked].sort((a, b) => b.avg - a.avg)[0];
    const worst = [...ranked].sort((a, b) => a.avg - b.avg)[0];
    out.push({ tone: "good", text: `${best.track} is your best-fitting track (avg ${best.avg.toFixed(1)}, ${best.strong} of ${best.count} scored 4.0+).` });
    if (worst.track !== best.track && worst.strong === 0) {
      out.push({ tone: "info", text: `${worst.track} has produced no 4.0+ fits in ${worst.count} roles (avg ${worst.avg.toFixed(1)}) — consider narrowing its scan filters.` });
    }
  }
  const top = reasons.find((r) => r.key !== "other");
  if (top && top.count >= 3) out.push({ tone: "info", text: `Top reason roles are skipped: ${top.label.toLowerCase()} (${top.count}). Filtering for it earlier saves evaluation time.` });
  if (catchDays !== null) {
    out.push({
      tone: catchDays <= 7 ? "good" : "info",
      text: `You typically evaluate a role ${catchDays} day${catchDays === 1 ? "" : "s"} after it's posted${catchDays > 7 ? " — scanning more often gets you in earlier." : "."}`,
    });
  }
  return out;
}
