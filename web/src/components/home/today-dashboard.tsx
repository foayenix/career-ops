"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CircleHelp, Sparkles, ArrowRight, CalendarClock, Hourglass, Star } from "lucide-react";
import { instrumentSerif } from "@/lib/fonts";
import { HeroGlow } from "@/components/hero-glow";
import type { Application, InboxJob } from "@/lib/career-ops";
import type { DiscoveredOffer } from "@/lib/explore";
import { DiscoveryCard } from "@/components/explore/discovery-card";
import { FollowUpCard, type FollowUp } from "@/components/home/follow-up-card";
import { DecisionCard } from "@/components/home/decision-card";
import { AutopilotStatus } from "@/components/home/autopilot-status";
import { QuickEvaluate } from "@/components/quick-evaluate";
import { scoreNum } from "@/lib/format";
import { pickAwaitingDecision } from "@/lib/home/awaiting.mjs";
import type { DeadlineRow } from "@/lib/home/deadlines.mjs";
import { DeadlineBoard } from "@/components/home/deadline-board";
import { cn } from "@/lib/cn";

// The retention "Today": a dual-loop action queue (the maintainer's
// "N new matches this week · M follow-ups due"). SUPPLY loop = fresh free-scan
// matches (zero tokens, /api/whats-new); DEMAND loop = follow-ups due
// (/api/followups). Each item one-tap actionable. Home stays a VIEW over the
// canonical files — every action dispatches a real registry action / route.
export function TodayDashboard({
  applications,
  trackedCount,
  inbox,
  inBetween,
  deadlines = [],
  today,
}: {
  applications: Application[];
  trackedCount: number;
  inbox: Pick<InboxJob, "url" | "done">[];
  inBetween: boolean;
  /** Undecided roles with their posting timeline, soonest-closing first. */
  deadlines?: DeadlineRow[];
  /** The server's local YYYY-MM-DD, so the calendar and the dates agree. */
  today?: string;
}) {
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [nextUpcoming, setNextUpcoming] = useState<FollowUp | null>(null);
  const [fresh, setFresh] = useState<DiscoveredOffer[]>([]);
  const [freshCount, setFreshCount] = useState(0);
  const router = useRouter();
  const dateLabel = useMemo(() => new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }), []);

  const refetch = useCallback(() => {
    fetch("/api/followups")
      .then((r) => r.json())
      .then((d) => {
        // /api/followups already filters to urgency 'urgent'/'overdue' — due
        // now, never 'waiting'/'cold' (#86). Both count toward "due"; a
        // missing metadata.overdue must read as 0 due, never as "every entry
        // is overdue" (the old `?? d.entries?.length` fallback).
        setFollowups(Array.isArray(d.entries) ? d.entries : []);
        setOverdue((d.metadata?.overdue ?? 0) + (d.metadata?.urgent ?? 0));
        setNextUpcoming(d.nextUpcoming ?? null);
      })
      .catch(() => {});
    fetch("/api/whats-new")
      .then((r) => r.json())
      .then((d) => {
        const offers = Array.isArray(d.offers) ? d.offers : [];
        const count = Number(d.count);
        setFresh(offers);
        setFreshCount(Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : offers.length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
    // A worker (evaluate/pdf) just wrote a real tracker row — refresh the server
    // snapshot (applications/inbox props) + the client loops so the freshly-scored
    // role appears in "Awaiting your decision" without a manual reload.
    const onDone = () => {
      router.refresh();
      refetch();
    };
    window.addEventListener("co-job-done", onDone);
    return () => window.removeEventListener("co-job-done", onDone);
  }, [refetch, router]);

  // Awaiting decision: scored (Evaluated) but no terminal status yet. The
  // ordering lives in lib/home/awaiting.mjs so it can be tested — see the file
  // for why "first six in the array" was a bug waiting for #3529.
  const awaiting = useMemo(() => pickAwaitingDecision(applications, scoreNum), [applications]);

  const newThisWeek = freshCount;
  const closingSoon = deadlines.filter((d) => ["today", "soon", "week"].includes(d.deadline.urgency)).length;
  const closingToday = deadlines.filter((d) => d.deadline.urgency === "today").length;
  const strongOpen = deadlines.filter((d) => d.deadline.urgency !== "closed" && scoreNum(d.score) >= 4).length;
  const allClear = newThisWeek === 0 && overdue === 0 && awaiting.length === 0 && closingSoon === 0;
  const inboxUrls = useMemo(() => new Set(inbox.map((j) => j.url)), [inbox]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-24">
      <section className="dot-bg relative overflow-hidden rounded-2xl border border-border bg-surface/40 px-7 py-10 md:px-10 md:py-12">
        <HeroGlow />
        {/* Readability scrim between the animated glow (z-0) and the copy (z-10). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] bg-surface/55 backdrop-blur-[2px] dark:bg-background/45" />
        <div className="relative z-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            <span className="text-faint">//</span> today · <span className="tabular-nums">{dateLabel}</span>
          </p>
          <h1 className={`${instrumentSerif.className} mt-3 text-4xl leading-[1.05] text-landing md:text-5xl`}>
            {allClear ? (
              <>You&apos;re all caught up.</>
            ) : (
              [
                closingSoon > 0 && (
                  <span key="closing">
                    <span className="text-brand tabular-nums">{closingSoon}</span> closing this week
                  </span>
                ),
                newThisWeek > 0 && (
                  <span key="new">
                    <span className="text-brand tabular-nums">{newThisWeek}</span> new match{newThisWeek === 1 ? "" : "es"}
                  </span>
                ),
                overdue > 0 && (
                  <span key="due">
                    <span className="text-brand tabular-nums">{overdue}</span> follow-up{overdue === 1 ? "" : "s"} due
                  </span>
                ),
                // Only undecided roles left — say so, rather than an empty headline.
                closingSoon === 0 && newThisWeek === 0 && overdue === 0 && awaiting.length > 0 && (
                  <span key="awaiting">
                    <span className="text-brand tabular-nums">{applications.length}</span> role{applications.length === 1 ? "" : "s"} to decide on
                  </span>
                ),
              ]
                .filter(Boolean)
                .flatMap((el, i) => (i === 0 ? [el] : [<span key={`sep-${i}`} className="text-faint"> · </span>, el]))
            )}
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted">
            {allClear
              ? "I'll keep scanning the market in the background and surface anything that fits."
              : closingToday > 0
                ? `${closingToday} application${closingToday === 1 ? " closes" : "s close"} today — start there.`
                : "Your action queue for today — deadlines, discovery and follow-ups, in one place."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/explore" className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]">
              Find new roles <ArrowRight className="size-4" />
            </Link>
            <Link href="/pipeline" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]">
              Open pipeline
            </Link>
          </div>
          {/* Paste any job link → full evaluation (report + score + tracker row). */}
          <QuickEvaluate />
        </div>
      </section>

      {/* At-a-glance numbers. Each tile jumps to the section that acts on it. */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi href="#deadlines" icon={CalendarClock} value={closingSoon} label="closing this week" tone={closingSoon > 0 ? "alert" : "calm"} />
        <Kpi href="/review" icon={CircleHelp} value={applications.length} label="to decide" />
        <Kpi href="#decide" icon={Star} value={strongOpen} label="strong fits 4.0+" tone={strongOpen > 0 ? "good" : "calm"} />
        <Kpi href="/followups" icon={Hourglass} value={overdue} label="follow-ups due" tone={overdue > 0 ? "alert" : "calm"} />
      </div>

      <AutopilotStatus />

      {/* 0. Deadlines — what closes first, and what has no fixed date */}
      {deadlines.length > 0 && today && (
        <Section id="deadlines" icon={CalendarClock} title="Deadlines" hint="Apply before these close">
          <DeadlineBoard rows={deadlines} today={today} />
        </Section>
      )}

      {/* A. Follow-ups due (demand loop) */}
      {followups.length > 0 ? (
        <Section icon={Bell} title="Follow-ups due" hint="Keep your applications alive — a nudge beats silence">
          <div className="grid gap-2.5">
            {followups.map((f) => (
              // Refetch (not a local decrement) so the parent's followups/nextUpcoming
              // stay in sync with the server — logging the LAST due item must flip this
              // section over to "Next follow-up" instead of leaving it empty.
              <FollowUpCard key={`${f.num}-${f.company}`} followup={f} onLogged={refetch} />
            ))}
          </div>
        </Section>
      ) : (
        nextUpcoming && (
          // Nothing is due — say so honestly instead of an empty "due" block,
          // but still surface what's next so the queue isn't silent (#86).
          <Section icon={Bell} title="Next follow-up" hint="Nothing due yet">
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">{nextUpcoming.company}</span>
              {nextUpcoming.role && <span> · {nextUpcoming.role}</span>}
              {nextUpcoming.nextFollowupDate && <span className="text-faint"> — upcoming {nextUpcoming.nextFollowupDate}</span>}
            </p>
          </Section>
        )
      )}

      {/* B. Awaiting your decision */}
      {awaiting.length > 0 && (
        <Section id="decide" icon={CircleHelp} title="Awaiting your decision" hint="Scored — apply or skip">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {awaiting.map((a) => (
              <DecisionCard key={a.n} app={a} />
            ))}
          </div>
          {applications.length > awaiting.length && (
            <Link href="/review" className="mt-3 inline-flex items-center text-sm text-muted transition hover:text-brand max-sm:min-h-[44px]">
              Review all {applications.length} →
            </Link>
          )}
        </Section>
      )}

      {/* C. Fresh matches this week (supply loop) */}
      {fresh.length > 0 && (
        <Section icon={Sparkles} title="Fresh matches this week" hint="Found by your free scans · 0 tokens">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fresh.slice(0, 6).map((o) => (
              <DiscoveryCard key={o.url} offer={o} inPipeline={inboxUrls.has(o.url)} />
            ))}
          </div>
          {fresh.length > 6 && (
            <Link href="/explore?view=fresh" className="mt-3 inline-flex items-center text-sm text-muted transition hover:text-brand max-sm:min-h-[44px]">
              See all {freshCount} →
            </Link>
          )}
        </Section>
      )}

      {allClear && (
        <div className="mt-8 rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
          <Sparkles className="mx-auto size-6 text-brand" />
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Nothing needs you right now. Run a <Link href="/explore" className="text-brand hover:underline">free scan</Link> to surface this week&apos;s roles, or check your <Link href="/pipeline" className="text-brand hover:underline">pipeline</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

function Kpi({
  href,
  icon: Icon,
  value,
  label,
  tone = "calm",
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  tone?: "calm" | "alert" | "good";
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface/40 px-3.5 py-3 transition hover:border-brand/40 hover:bg-surface-hover"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          tone === "alert" ? "bg-red-500/10 text-red-600 dark:text-red-400" : tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-surface-hover text-muted",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</span>
        <span className="mt-1 block text-xs leading-tight text-muted">{label}</span>
      </span>
    </Link>
  );
}

function Section({ id, icon: Icon, title, hint, children }: { id?: string; icon: React.ComponentType<{ className?: string }>; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
        <span className="text-xs text-faint">· {hint}</span>
      </div>
      {children}
    </section>
  );
}
