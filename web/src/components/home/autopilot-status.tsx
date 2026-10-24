"use client";

import { useEffect, useState } from "react";
import { Bot, Circle, CircleCheck, CircleMinus, CircleX, LoaderCircle } from "lucide-react";

type StepState = "pending" | "running" | "done" | "failed" | "skipped";
type Step = { key: string; label: string; state: StepState; startedAt: string | null; endedAt: string | null; detail: string };
type Evaluation = { offer: string; url: string; outcome: "running" | "completed" | "failed"; score: string | null; report: string | null };
type Run = {
  date: string;
  slot: string;
  startedAt: string;
  endedAt: string | null;
  finished: boolean;
  fatal: string | null;
  steps: Step[];
  queued: string[];
  evaluations: Evaluation[];
};
type Status =
  | { available: false }
  | { available: true; running: boolean; run: Run | null; jev?: Record<"pass" | "fail" | "review" | "no_jd", number> | null };

const POLL_MS = 5000;

// "HH:MM:SS" today → elapsed "12m" / "1h 05m" (the log carries local times only).
function elapsed(from: string, to?: string | null): string {
  const toSecs = (t: string) => t.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
  const end = to ? toSecs(to) : toSecs(new Date().toTimeString().slice(0, 8));
  const mins = Math.max(0, Math.round((end - toSecs(from)) / 60));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") return <LoaderCircle className="size-4 animate-spin text-brand" />;
  if (state === "done") return <CircleCheck className="size-4 text-emerald-500" />;
  if (state === "failed") return <CircleX className="size-4 text-red-500" />;
  if (state === "skipped") return <CircleMinus className="size-4 text-faint" />;
  return <Circle className="size-4 text-faint" />;
}

// Progress of the personal autopilot (local/autopilot.mjs), polled while open.
// Renders nothing when this install has no autopilot.
export function AutopilotStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/autopilot")
        .then((r) => r.json())
        .then((d) => alive && !d.error && setStatus(d))
        .catch(() => {});
    load();
    const poll = setInterval(() => {
      load();
      setTick((t) => t + 1); // re-render so running timers advance
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, []);

  if (!status?.available || !status.run) return null;
  const { run, running, jev } = status;
  const headline = running
    ? `Running · ${elapsed(run.startedAt)}`
    : run.fatal
      ? `Stopped: ${run.fatal}`
      : `Finished at ${run.endedAt?.slice(0, 5)} · took ${elapsed(run.startedAt, run.endedAt)}`;

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">Autopilot</h2>
        <span className="text-xs text-faint">
          · {run.slot} run {run.date}, started {run.startedAt.slice(0, 5)} · next at 08:00 / 20:00
        </span>
      </div>
      <div className="rounded-2xl border border-border bg-surface/30 p-5">
        <p className={`text-sm font-medium ${run.fatal ? "text-red-500" : running ? "text-brand" : "text-foreground"}`}>{headline}</p>
        <ol className="mt-4 grid gap-2.5">
          {run.steps.map((s) => (
            <li key={s.key} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0">
                <StepIcon state={s.state} />
              </span>
              <span className={s.state === "pending" || s.state === "skipped" ? "text-faint" : "text-foreground"}>{s.label}</span>
              <span className="ml-auto min-w-0 truncate text-right text-xs text-muted tabular-nums">
                {s.state === "running" && s.startedAt && `${elapsed(s.startedAt)} so far`}
                {(s.state === "done" || s.state === "failed") && s.startedAt && s.endedAt && elapsed(s.startedAt, s.endedAt)}
                {s.detail && <span className="text-faint"> · {s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>

        {jev && jev.pass + jev.fail + jev.review + jev.no_jd > 0 && (
          <p className="mt-4 text-xs text-muted">
            Jev today: <span className="text-foreground tabular-nums">{jev.pass}</span> passed ·{" "}
            <span className="tabular-nums">{jev.fail}</span> blocked · <span className="tabular-nums">{jev.no_jd}</span> unreadable
            {jev.review > 0 && <> · <span className="tabular-nums">{jev.review}</span> low confidence</>}
          </p>
        )}

        {run.queued.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-faint">Queued for Claude</p>
            <ul className="mt-1.5 grid gap-1 text-sm text-muted">
              {run.queued.map((q) => (
                <li key={q} className="truncate">{q}</li>
              ))}
            </ul>
          </div>
        )}

        {run.evaluations.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-faint">Evaluated this run</p>
            <ul className="mt-1.5 grid gap-1 text-sm">
              {run.evaluations.map((e) => (
                <li key={e.offer} className="flex items-center gap-2">
                  <StepIcon state={e.outcome === "completed" ? "done" : e.outcome === "failed" ? "failed" : "running"} />
                  <a href={e.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-muted hover:text-brand">
                    {e.url.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                  {e.score && <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground">{e.score}/5</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
