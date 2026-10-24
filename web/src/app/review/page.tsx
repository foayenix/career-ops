import { readApplications, readReport, pdfReadyForReport, type Application } from "@/lib/career-ops";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { scoreNum } from "@/lib/format";
import { reviewQueue } from "@/lib/review-queue.mjs";
import { ReportView } from "@/components/report-view";
import { ReviewQueue } from "@/components/review/review-queue";

export const dynamic = "force-dynamic"; // always read fresh local files

// One focused queue: every evaluated-but-undecided role, the selected one's
// evaluation beside it. Deciding (Skip / Discard / Applied) removes the role
// and moves on to the next — no trip back to the full pipeline in between.
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id: wanted } = await searchParams;
  const queue = reviewQueue(readApplications(), scoreNum) as Application[];
  const selected = queue.find((a) => a.n === wanted) ?? queue[0] ?? null;
  const report = selected ? readReport(selected.n) : null;
  return (
    <ReviewQueue items={queue} selectedId={selected?.n ?? null}>
      {selected && (
        <ReportView
          key={selected.n}
          id={selected.n}
          app={selected}
          report={report?.content ?? null}
          pdfReadyFromIndex={await pdfReadyForReport(selected.n)}
          coverReady={(await resolveTailoredCover(selected.company, selected.n)) !== null}
          embedded
        />
      )}
    </ReviewQueue>
  );
}
