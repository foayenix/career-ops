"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, FileText, Loader2, Repeat, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTone } from "@/lib/format";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { dayNumber, relativeDays, type DeadlineRow } from "@/lib/home/deadlines.mjs";

// Urgency → colour. Red only for "act today/within 3 days"; amber for this
// week; everything else stays calm so the eye goes where the clock is.
const TONE: Record<string, { chip: string; bar: string; dot: string }> = {
  today: { chip: "bg-red-500/12 text-red-600 dark:text-red-400 ring-red-500/30", bar: "bg-red-500", dot: "bg-red-500" },
  soon: { chip: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/25", bar: "bg-red-500/80", dot: "bg-red-500" },
  week: { chip: "bg-amber-500/12 text-amber-700 dark:text-amber-400 ring-amber-500/30", bar: "bg-amber-500", dot: "bg-amber-500" },
  later: { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25", bar: "bg-emerald-500/70", dot: "bg-emerald-500" },
  rolling: { chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/25", bar: "bg-sky-500/60", dot: "bg-sky-500" },
  open: { chip: "bg-surface-hover text-muted ring-border", bar: "bg-foreground/20", dot: "bg-foreground/30" },
  closed: { chip: "bg-surface-hover text-faint ring-border", bar: "bg-foreground/15", dot: "bg-foreground/20" },
};

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", opts);

function headline(r: DeadlineRow): string {
  const d = r.deadline;
  switch (d.urgency) {
    case "today":
      return "Closes today";
    case "soon":
    case "week":
    case "later":
      return d.daysLeft === 1 ? "Closes tomorrow" : `${d.daysLeft} days left`;
    case "rolling":
      return r.closes ? "Rolling" : "Rolling · apply early";
    case "closed":
      return r.closes && d.daysLeft !== null && d.daysLeft < 0 ? `Closed ${relativeDays(d.daysLeft)}` : "Posting closed";
    default:
      return "No closing date";
  }
}

function subline(r: DeadlineRow): string {
  const parts: string[] = [];
  if (r.closes && r.deadline.urgency !== "closed") parts.push(`closes ${fmtDay(r.closes)}`);
  if (r.rolling && r.closes) parts.push("may close early");
  if (r.posted && r.deadline.postedDaysAgo !== null) {
    const ago = r.deadline.postedDaysAgo;
    parts.push(ago === 0 ? "posted today" : `posted ${ago} day${ago === 1 ? "" : "s"} ago`);
  }
  return parts.join(" · ");
}

export function DeadlineBoard({ rows, today }: { rows: DeadlineRow[]; today: string }) {
  const [showClosed, setShowClosed] = useState(false);
  const live = rows.filter((r) => r.deadline.urgency !== "closed");
  const closed = rows.filter((r) => r.deadline.urgency === "closed");

  return (
    <div className="space-y-4">
      <CalendarStrip rows={live} today={today} />
      {live.length > 0 && (
        <div className="grid gap-2.5">
          {live.map((r) => (
            <DeadlineRowCard key={r.n} row={r} />
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <div className="rounded-xl border border-dashed border-border">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-muted transition hover:text-foreground max-sm:min-h-[44px]"
          >
            <ChevronDown className={cn("size-4 transition", showClosed && "rotate-180")} />
            <span>
              <span className="font-medium text-foreground tabular-nums">{closed.length}</span> closed before you decided
            </span>
            <span className="ml-auto text-xs text-faint">tidy them up</span>
          </button>
          {showClosed && (
            <div className="grid gap-2 border-t border-dashed border-border p-2.5">
              {closed.map((r) => (
                <DeadlineRowCard key={r.n} row={r} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Two weeks at a glance. Each day shows the roles that close on it; a day with
// nothing stays quiet. Rolling/undated roles have no day, so they live only in
// the list below — the strip is strictly "what has a date".
function CalendarStrip({ rows, today }: { rows: DeadlineRow[]; today: string }) {
  const days = useMemo(() => {
    const start = dayNumber(today);
    return Array.from({ length: 14 }, (_, i) => {
      const iso = new Date((start + i) * 86_400_000).toISOString().slice(0, 10);
      return { iso, i, items: rows.filter((r) => r.closes === iso) };
    });
  }, [rows, today]);
  const later = rows.filter((r) => r.deadline.daysLeft !== null && r.deadline.daysLeft >= 14).length;

  return (
    <div className="rounded-xl border border-border bg-surface/40 p-3">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const urgency = d.items[0]?.deadline.urgency;
          return (
            <div
              key={d.iso}
              title={d.items.map((r) => `${companyPresentation(r).label} — ${r.role}`).join("\n") || undefined}
              className={cn(
                "flex min-h-[64px] min-w-0 flex-col rounded-lg border px-0.5 py-1.5 text-center transition sm:px-1.5",
                d.i === 0 ? "border-brand/50 bg-brand-soft" : "border-transparent",
                d.items.length > 0 && d.i !== 0 && "border-border bg-surface",
              )}
            >
              <span className={cn("truncate text-[10px] uppercase sm:tracking-wider", d.i === 0 ? "text-brand-text" : "text-faint")}>
                {d.i === 0 ? (
                  <>
                    {/* "TODAY" outgrows a phone-width cell; the ring marks it there. */}
                    <span className="sm:hidden">{fmtDay(d.iso, { weekday: "short" })}</span>
                    <span className="hidden sm:inline">Today</span>
                  </>
                ) : (
                  fmtDay(d.iso, { weekday: "short" })
                )}
              </span>
              <span className={cn("text-sm tabular-nums", d.items.length ? "font-semibold text-foreground" : "text-muted")}>{fmtDay(d.iso, { day: "numeric" })}</span>
              {d.items.length > 0 && (
                <span className="mt-auto flex items-center justify-center gap-1">
                  <span className={cn("size-1.5 rounded-full", TONE[urgency ?? "open"].dot)} />
                  <span className="text-[11px] font-medium tabular-nums text-foreground">{d.items.length}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-faint">
        Next 14 days
        {later > 0 && <> · <span className="tabular-nums">{later}</span> closing later</>}
        {rows.some((r) => r.closes === null) && <> · {rows.filter((r) => r.closes === null).length} with no fixed date</>}
      </p>
    </div>
  );
}

function DeadlineRowCard({ row, compact = false }: { row: DeadlineRow; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const company = companyPresentation(row);
  const tone = TONE[row.deadline.urgency] ?? TONE.open;
  const score = scoreNum(row.score);
  const scoreT = scoreTone(row.score);
  const stale = row.deadline.urgency === "open" && (row.deadline.postedDaysAgo ?? 0) > 30;

  const skip = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: row.n, status: "Discarded" }) });
      if (res.ok) {
        setGone(true);
        router.refresh();
      }
    } catch {
      /* leave the row; the user can retry */
    } finally {
      setBusy(false);
    }
  };

  if (gone) return null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface/40 p-3.5 transition hover:border-brand/30 sm:flex-row sm:items-center", compact && "bg-transparent p-2.5 opacity-80")}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <CompanyLogo name={company.logoName} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-foreground">{company.label}</p>
            {Number.isFinite(score) && score > 0 && (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-px text-[11px] font-semibold tabular-nums",
                  scoreT === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : scoreT === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-surface-hover text-muted",
                )}
              >
                {row.score}
              </span>
            )}
          </div>
          <p className="truncate text-[13px] text-muted">{row.role}</p>
          {!compact && (
            <div className="mt-2 flex items-center gap-2">
              {/* Posted → closes: how much of the advertised window is gone. */}
              <div className="relative h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                <div
                  className={cn("h-full rounded-full", tone.bar, row.deadline.progress === null && "opacity-40")}
                  style={{ width: `${Math.round((row.deadline.progress ?? (row.deadline.urgency === "rolling" ? 0.5 : 0.15)) * 100)}%` }}
                />
              </div>
              <span className="truncate text-xs text-faint">{subline(row)}</span>
            </div>
          )}
          {stale && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Open for over a month — check it&apos;s still live before tailoring a CV.</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset", tone.chip)}>
          {row.deadline.urgency === "rolling" && <Repeat className="mr-1 inline size-3 -translate-y-px" />}
          {headline(row)}
        </span>
        <div className="flex items-center gap-1.5 max-sm:ml-auto">
          <Link
            href={`/review?id=${encodeURIComponent(row.n)}`}
            className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-text transition hover:bg-brand/15 max-sm:min-h-[44px]"
          >
            <FileText className="size-3.5" /> {row.deadline.urgency === "closed" ? "Report" : "Review & apply"}
          </Link>
          {row.deadline.urgency === "closed" && (
            <button
              type="button"
              onClick={skip}
              disabled={busy}
              title="Mark Discarded — the posting has closed"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px]"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Discard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
