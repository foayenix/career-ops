"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Ban, Check, Undo2, Maximize2, PartyPopper, Inbox, Compass, Loader2 } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { CompanyLogo } from "@/components/company-logo";
import { Badge } from "@/components/ui/badge";
import { usePipeline } from "@/components/pipeline/pipeline-provider";
import { scoreTone } from "@/lib/format";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { saveStatus } from "@/lib/pipeline-status.mjs";
import { nextAfterRemoval } from "@/lib/review-queue.mjs";
import { cn } from "@/lib/cn";

type Decision = "SKIP" | "Discarded" | "Applied";

const DECISION_LABEL: Record<Decision, string> = {
  SKIP: "Skipped",
  Discarded: "Discarded",
  Applied: "Marked applied",
};

type Toast = { n: string; company: string; status: Decision; prev: string };

export function ReviewQueue({
  items,
  selectedId,
  children,
}: {
  items: Application[];
  selectedId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { refetch: refetchPipeline } = usePipeline();
  const [pending, startTransition] = useTransition();
  // Decided here but maybe not yet gone from the server snapshot: hidden at
  // once so the list never shows a role you just dealt with.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // The last decision stays undoable (U) after its toast fades.
  const [toast, setToast] = useState<Toast | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => items.filter((a) => !removed.has(a.n)), [items, removed]);
  const current = visible.find((a) => a.n === selectedId) ?? visible[0] ?? null;
  const index = current ? visible.indexOf(current) : -1;

  const go = useCallback(
    (n: string | null) => {
      startTransition(() => router.replace(n ? `/review?id=${encodeURIComponent(n)}` : "/review", { scroll: false }));
    },
    [router],
  );

  // New role on screen → start reading it from the top, and keep its row in view.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    listRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [current?.n]);

  useEffect(() => {
    if (!toast) return;
    setToastVisible(true);
    const t = setTimeout(() => setToastVisible(false), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const decide = useCallback(
    async (status: Decision) => {
      if (!current || busy) return;
      const app = current;
      const next = nextAfterRemoval(visible.map((a) => a.n), app.n);
      setError("");
      setBusy(true);
      setRemoved((s) => new Set(s).add(app.n));
      go(next);
      try {
        await saveStatus(app.n, app.status, status);
        setToast({ n: app.n, company: companyPresentation(app).label, status, prev: app.status });
        refetchPipeline();
      } catch (e) {
        // Put it back where it was: nothing was written.
        setRemoved((s) => {
          const copy = new Set(s);
          copy.delete(app.n);
          return copy;
        });
        go(app.n);
        setError(e instanceof Error ? e.message : "Could not save. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [current, busy, visible, go, refetchPipeline],
  );

  const undo = useCallback(async () => {
    if (!toast || busy) return;
    const t = toast;
    setToast(null);
    setBusy(true);
    try {
      await saveStatus(t.n, t.status, "Evaluated");
      setRemoved((s) => {
        const copy = new Set(s);
        copy.delete(t.n);
        return copy;
      });
      go(t.n);
      startTransition(() => router.refresh());
      refetchPipeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo. Try again.");
    } finally {
      setBusy(false);
    }
  }, [toast, busy, go, router, refetchPipeline]);

  const step = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const target = visible[Math.min(Math.max(index + delta, 0), visible.length - 1)];
      if (target && target !== current) go(target.n);
    },
    [index, visible, current, go],
  );

  // Keyboard: J/K or ←/→ to move, S skip, D discard, U undo. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "arrowright") step(1);
      else if (k === "k" || k === "arrowleft") step(-1);
      else if (k === "s") void decide("SKIP");
      else if (k === "d") void decide("Discarded");
      else if (k === "u" || k === "z") void undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, decide, undo]);

  return (
    <div className="flex min-h-screen max-lg:flex-col">
      {/* ── Queue ── */}
      <aside className="hidden w-72 shrink-0 xl:w-80 flex-col border-r border-border bg-surface/20 lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="border-b border-border px-5 pb-4 pt-6">
          <h1 className="font-display text-2xl tracking-tight text-landing">Review</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums text-foreground">{visible.length}</span> waiting for your decision
          </p>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {visible.map((a) => (
            <QueueRow key={a.n} app={a} active={a.n === current?.n} onSelect={() => go(a.n)} />
          ))}
        </div>
        <p className="border-t border-border px-5 py-3 text-[11px] leading-relaxed text-faint">
          <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>S</Kbd> skip · <Kbd>D</Kbd> discard · <Kbd>U</Kbd> undo
        </p>
      </aside>

      {/* ── Evaluation ── */}
      <section className="min-w-0 flex-1 max-sm:pb-24">
        {current ? (
          <>
            <div className="z-20 flex items-center gap-2 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur sm:px-8 sticky top-0 max-md:top-[calc(env(safe-area-inset-top)+4.375rem)]">
              <div className="flex items-center">
                <IconButton label="Previous (K)" disabled={index <= 0} onClick={() => step(-1)}>
                  <ChevronLeft className="size-4" />
                </IconButton>
                <span className="min-w-[3.75rem] text-center text-xs tabular-nums text-muted">
                  {index + 1} of {visible.length}
                </span>
                <IconButton label="Next (J)" disabled={index >= visible.length - 1} onClick={() => step(1)}>
                  <ChevronRight className="size-4" />
                </IconButton>
              </div>
              {pending && <Loader2 className="size-4 animate-spin text-faint" aria-label="Loading" />}
              <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <Link
                  href={`/pipeline/${current.n}`}
                  title="Open as a full page"
                  className="hidden size-9 items-center justify-center rounded-full text-faint transition hover:bg-surface-hover hover:text-foreground xl:inline-flex"
                >
                  <Maximize2 className="size-4" />
                </Link>
                <DecisionButton
                  onClick={() => decide("Applied")}
                  disabled={busy}
                  title="Record Applied without opening the apply flow"
                  className="text-muted hover:text-foreground max-sm:hidden max-xl:px-2.5"
                >
                  <Check className="size-4" /> <span className="max-xl:sr-only">Applied</span>
                </DecisionButton>
                <DecisionButton
                  onClick={() => decide("Discarded")}
                  disabled={busy}
                  title="Not interested, or the posting closed (D)"
                  className="border border-border text-muted hover:border-foreground/30 hover:text-foreground"
                >
                  <Ban className="size-4" /> Discard
                </DecisionButton>
                <DecisionButton
                  onClick={() => decide("SKIP")}
                  disabled={busy}
                  title="Doesn't fit, don't apply (S)"
                  className="bg-foreground text-background hover:bg-foreground/85"
                >
                  <X className="size-4" /> Skip
                </DecisionButton>
              </div>
            </div>
            {error && (
              <p role="alert" className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400 sm:mx-8">
                {error}
              </p>
            )}
            <div className={cn("transition-opacity", pending && "opacity-60")}>{children}</div>
          </>
        ) : (
          <AllDone />
        )}
      </section>

      {toast && toastVisible && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-lg max-md:bottom-24"
        >
          <span className="text-muted">
            {DECISION_LABEL[toast.status]} <span className="font-medium text-foreground">{toast.company}</span>
          </span>
          <button
            type="button"
            onClick={undo}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-brand transition hover:bg-brand-soft"
          >
            <Undo2 className="size-3.5" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}

function QueueRow({ app, active, onSelect }: { app: Application; active: boolean; onSelect: () => void }) {
  const company = companyPresentation(app);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-brand-soft" : "hover:bg-surface-hover",
      )}
    >
      <CompanyLogo name={company.logoName} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-sm font-medium", active ? "text-brand-text" : "text-foreground")}>{company.label}</span>
          {app.score && <Badge tone={scoreTone(app.score)} className="ml-auto shrink-0">{app.score.replace(/\/5$/, "")}</Badge>}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">{app.role}</span>
        {app.notes && <span className="mt-1 line-clamp-2 text-xs leading-snug text-faint">{app.notes}</span>}
      </span>
    </button>
  );
}

function DecisionButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className="inline-flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

function AllDone() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <PartyPopper className="mx-auto size-8 text-brand" />
      <h1 className="mt-4 font-display text-2xl tracking-tight text-landing">Nothing left to review</h1>
      <p className="mt-2 text-sm text-muted">Every evaluated role has a decision. New evaluations will show up here.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link href="/pipeline" className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:border-brand/40 hover:text-brand">
          <Inbox className="size-4" /> Triage the inbox
        </Link>
        <Link href="/explore" className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-200">
          <Compass className="size-4" /> Find new roles
        </Link>
      </div>
    </div>
  );
}
