import Link from "next/link";
import { Lightbulb, AlertTriangle, TrendingUp } from "lucide-react";
import { pipelineSummary, readApplicationStatusLog, readReport, readStatusLog } from "@/lib/career-ops";
import { PipelineSankey } from "@/components/analytics/pipeline-sankey";
import { canonStatus, scoreNum } from "@/lib/format";
import { cumulativeTilesWithHistory } from "@/lib/funnel-tiles.mjs";
import { conversion, insights, medianDaysToCatch, skipReasons, trackBreakdown, weeklyActivity } from "@/lib/analytics-insights.mjs";
import { buildDeadlineQueue, extractPostingTimeline, localIsoDate } from "@/lib/home/deadlines.mjs";

export const dynamic = "force-dynamic";

const STAGES: { key: string; label: string }[] = [
  { key: "EVALUATED", label: "Evaluated" },
  { key: "APPLIED", label: "Applied" },
  { key: "RESPONDED", label: "Responded" },
  { key: "INTERVIEW", label: "Interview" },
  { key: "OFFER", label: "Offer" },
  { key: "HIRED", label: "Hired" },
  { key: "REJECTED", label: "Rejected" },
  { key: "DISCARDED", label: "Discarded" },
];

export default async function Analytics() {
  const { applications } = pipelineSummary();
  const statusLog = readStatusLog();
  const total = applications.length;

  const stageCounts = STAGES.map((s) => ({
    ...s,
    n: applications.filter((a) => canonStatus(a.status).includes(s.key)).length,
  }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.n));

  const scores = applications.map((a) => scoreNum(a.score)).filter((n) => !Number.isNaN(n));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const buckets = [
    { label: "4.5 – 5.0", test: (n: number) => n >= 4.5 },
    { label: "4.0 – 4.4", test: (n: number) => n >= 4 && n < 4.5 },
    { label: "3.0 – 3.9", test: (n: number) => n >= 3 && n < 4 },
    { label: "< 3.0", test: (n: number) => n < 3 },
  ].map((b) => ({ label: b.label, n: scores.filter(b.test).length }));
  const maxBucket = Math.max(1, ...buckets.map((b) => b.n));

  const companyCounts = new Map<string, number>();
  for (const a of applications) if (a.company) companyCounts.set(a.company, (companyCounts.get(a.company) ?? 0) + 1);
  const topCompanies = [...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCompany = Math.max(1, ...topCompanies.map((c) => c[1]));

  // CUMULATIVE, unlike the stage bars above: these two tiles are achievement
  // counters whose zero-state shows a coaching nudge, so a candidate who has
  // already advanced past a stage must not read 0 for it (an offer-holder was
  // told "Interviews follow replies — keep follow-ups warm"). Mirrors
  // everInterview/everOffer in stats.mjs, including stages recovered from history.
  const { interviews, offers } = await cumulativeTilesWithHistory(
    applications.map((a) => ({ n: a.n, status: canonStatus(a.status) })),
    readApplicationStatusLog(),
  );

  // Derived insight — every number below comes from analytics-insights.mjs,
  // which the test suite exercises directly.
  const today = localIsoDate();
  const conv = conversion(applications, scoreNum);
  const tracks = trackBreakdown(applications, scoreNum);
  const reasons = skipReasons(applications);
  const maxReason = Math.max(1, ...reasons.map((r) => r.count));
  const weeks = weeklyActivity(applications, today, 8);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
  const thisWeek = weeks.at(-1)?.count ?? 0;
  const reports = new Map(applications.map((a) => [a.n, readReport(a.n)?.content]));
  const catchDays = medianDaysToCatch(applications.map((a) => ({ posted: extractPostingTimeline(a, reports.get(a.n)).posted, evaluated: a.date })));
  const closingSoon = buildDeadlineQueue(applications, (n) => reports.get(n), today, scoreNum).filter((d) =>
    ["today", "soon", "week"].includes(d.deadline.urgency),
  ).length;
  const takeaways = insights({ conv, tracks, reasons, catchDays, closingSoon });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-2xl tracking-tight text-landing">Analytics</h1>
      <p className="mt-1 text-sm text-muted">
        Across {total} tracked evaluation{total === 1 ? "" : "s"} · <span className="tabular-nums">{thisWeek}</span> this week.
      </p>

      {/* What the data says — plain-language, most actionable first */}
      {takeaways.length > 0 && (
        <section className="mt-6 rounded-2xl border border-border bg-surface/40 p-5">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
            <Lightbulb className="size-4 text-brand" /> What your data says
          </h2>
          <ul className="mt-3 space-y-2">
            {takeaways.map((t) => (
              <li key={t.text} className="flex items-start gap-2.5 text-sm text-foreground">
                {t.tone === "action" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Action" />
                ) : t.tone === "good" ? (
                  <TrendingUp className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Strength" />
                ) : (
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/30" aria-hidden />
                )}
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* headline stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={total} label="evaluated" />
        <Stat value={avg ? avg.toFixed(2) : "—"} label="avg score" />
        <Stat
          value={interviews}
          label="interviews"
          hint={interviews === 0 ? "Interviews follow replies — keep follow-ups warm →" : undefined}
        />
        <Stat
          value={offers}
          label="offers"
          hint={offers === 0 ? "Offers follow interviews — keep the conversations going →" : undefined}
        />
      </div>

      {/* conversion rates — the funnel as ratios */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={conv.strongShare === null ? "—" : `${conv.strongShare}%`} label={`strong fits (4.0+) · ${conv.strong}`} />
        <Stat value={conv.applyRate === null ? "—" : `${conv.applyRate}%`} label={`applied · ${conv.applied} of ${conv.total}`} />
        <Stat value={conv.responseRate === null ? "—" : `${conv.responseRate}%`} label="response rate" />
        <Stat value={catchDays === null ? "—" : `${catchDays}d`} label="median posting → evaluation" />
      </div>

      <Section title="Activity · evaluations per week">
        <div className="flex h-36 items-end gap-1.5 rounded-xl border border-border bg-surface/30 px-3 pb-2 pt-4" role="img" aria-label="Evaluations per week, last 8 weeks">
          {weeks.map((w, i) => (
            <div key={w.start} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`Week of ${w.start}: ${w.count} evaluated`}>
              <span className={`text-[11px] tabular-nums text-muted ${w.count ? "" : "opacity-0"}`}>{w.count}</span>
              <div
                className={`w-full max-w-10 rounded-t ${i === weeks.length - 1 ? "bg-brand" : "bg-brand/45"} transition group-hover:bg-brand`}
                style={{ height: `${w.count ? Math.max(4, (w.count / maxWeek) * 100) : 0}%` }}
              />
              <span className="text-[10px] tabular-nums text-faint">
                {new Date(`${w.start}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <PipelineSankey applications={applications} statusLog={statusLog} />

      <Section title="How your target tracks perform">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-faint">
                <th className="px-3 py-2 font-medium">Track</th>
                <th className="px-3 py-2 text-right font-medium">Roles</th>
                <th className="px-3 py-2 font-medium">Avg score</th>
                <th className="px-3 py-2 text-right font-medium">4.0+</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.track} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2.5 text-foreground">{t.track}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{t.count}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2" title={t.avg === null ? "No scores" : `Average ${t.avg.toFixed(2)} / 5`}>
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className={`h-full rounded-full ${t.avg !== null && t.avg >= 4 ? "bg-emerald-500" : t.avg !== null && t.avg >= 3 ? "bg-brand/70" : "bg-foreground/30"}`}
                          style={{ width: `${((t.avg ?? 0) / 5) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-muted">{t.avg === null ? "—" : t.avg.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{t.strong}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{t.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {reasons.length > 0 && (
        <Section title="Why roles get skipped">
          {reasons.map((r) => (
            <Bar key={r.key} label={r.label} value={r.count} pct={(r.count / maxReason) * 100} total={conv.skipped} wide />
          ))}
          <p className="text-xs text-faint">Read from the evaluator&apos;s notes on Skipped and Discarded roles; each role counts once, under its hardest blocker.</p>
        </Section>
      )}

      <Section title="Pipeline by stage">
        {stageCounts.map((s) => (
          <Bar
            key={s.key}
            label={s.label}
            value={s.n}
            pct={(s.n / maxStage) * 100}
            total={total}
            tone={s.key === "OFFER" ? "positive" : "neutral"}
          />
        ))}
      </Section>

      <Section title="Score distribution">
        {buckets.map((b) => (
          <Bar key={b.label} label={b.label} value={b.n} pct={(b.n / maxBucket) * 100} total={scores.length} />
        ))}
      </Section>

      <Section title="Top companies" id="companies">
        {topCompanies.map(([name, n]) => (
          <Bar key={name} label={name} value={n} pct={(n / maxCompany) * 100} />
        ))}
      </Section>
    </div>
  );
}

function Stat({ value, label, hint }: { value: number | string; label: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-4">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-faint">{label}</div>
      {hint && (
        <Link href="/" className="mt-2 block text-xs text-muted transition-colors hover:text-brand">
          {hint}
        </Link>
      )}
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{title}</h2>
      <div className="mt-4 space-y-2.5">{children}</div>
    </section>
  );
}

function Bar({
  label,
  value,
  pct,
  total,
  tone = "neutral",
  wide = false,
}: {
  label: string;
  value: number;
  pct: number;
  total?: number;
  tone?: "neutral" | "positive";
  /** Longer labels (reasons) get more room before truncating. */
  wide?: boolean;
}) {
  const share = total && total > 0 ? Math.round((value / total) * 100) : null;
  const fill =
    tone === "positive"
      ? "bg-gradient-to-r from-emerald-500/60 to-emerald-500/30"
      : "bg-gradient-to-r from-foreground/25 to-foreground/10";
  return (
    <div className="flex items-center gap-3" title={`${label}: ${value}`}>
      <div className={`${wide ? "w-32 sm:w-52" : "w-32"} shrink-0 truncate text-sm text-muted`}>{label}</div>
      <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-surface">
        <div
          className={`h-full rounded-md ${fill}`}
          style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }}
        />
      </div>
      <div className="w-20 shrink-0 text-right text-sm tabular-nums">
        {value}
        {share !== null && <span className="ml-1 text-xs text-faint">{share}%</span>}
      </div>
    </div>
  );
}
