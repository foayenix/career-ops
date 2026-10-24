"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// "Back" that returns to the page you actually came from — the Review queue,
// a filtered pipeline tab, Today — instead of always dumping you on the full
// pipeline. Falls back to `fallback` when there is no in-app history (a
// direct link, a new tab).
// document.referrer alone is not enough: client-side navigations never update
// it. The Navigation API sees the real previous entry; the referrer is the
// fallback for browsers without it (and only covers a full page load).
function cameFromThisApp(): boolean {
  const nav = (window as unknown as { navigation?: { currentEntry?: { index: number }; entries(): { url: string | null }[] } }).navigation;
  if (nav?.currentEntry) {
    const prev = nav.entries()[nav.currentEntry.index - 1];
    return !!prev?.url && prev.url.startsWith(window.location.origin);
  }
  return document.referrer.startsWith(window.location.origin) && window.history.length > 1;
}

export function BackLink({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (cameFromThisApp()) {
          e.preventDefault();
          router.back();
        }
      }}
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand"
    >
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}
