"use client";

import { useMemo } from "react";
import { usePipeline } from "@/components/pipeline/pipeline-provider";
import { scoreNum } from "@/lib/format";
import { reviewQueue } from "@/lib/review-queue.mjs";

// How many evaluated roles still need a decision — the same queue /review shows.
export function ReviewNavCount() {
  const { applications } = usePipeline();
  const count = useMemo(() => reviewQueue(applications, scoreNum).length, [applications]);
  if (count === 0) return null;
  return <span className="ml-auto rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-brand-foreground">{count}</span>;
}
