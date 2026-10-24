// Which link on a job page leads to its application form? Pure, so it can be tested
// without a browser; tryApplyTrigger() in diagnose.ts feeds it the page's anchors.
//
// The old rule took the FIRST anchor whose href mentioned an ATS domain. On the
// ATS's own page every link mentions that domain, so it picked whatever came
// first in the DOM: Lever's company logo (jobs.lever.co/palantir, the job list)
// or Greenhouse's "Create alert" (my.greenhouse.io/users/sign_in). Ranked here
// instead, best first:
//   1. a link labelled Apply whose href is an application path (/apply, /application)
//   2. any link labelled Apply
//   3. any link to an application path
//   4. a link to a known ATS on ANOTHER host (company careers page → ATS)
// Never: sign-in / register / alert / subscribe links, submit-like labels, or the
// page itself.

const APPLY_TEXT = /\bapply\b|start (your )?application|begin (your )?application/i;
const BAD_TEXT = /submit|applied|withdraw|alert|sign ?in|log ?in|register|filter|similar jobs/i;
const APP_PATH = /\/(apply|application)(\/|\?|#|$)/i;
const BAD_HREF = /sign[_-]?in|log[_-]?in|register|sign[_-]?up|\/users\/|alert|subscribe|submit/i;
const ATS_HOST = /ashbyhq|greenhouse|lever\.co|smartrecruiters|workable|recruitee|bamboohr|jobvite|teamtailor|myworkdayjobs/i;

/**
 * @param {{ href: string, text: string, visible: boolean }[]} anchors absolute hrefs
 * @param {string} currentUrl
 * @returns {string | null} the href to navigate to, or null when none qualifies
 */
export function pickApplyHref(anchors, currentUrl) {
  let here;
  try {
    here = new URL(currentUrl);
  } catch {
    return null;
  }
  const same = (u) => u.origin + u.pathname.replace(/\/$/, "") === here.origin + here.pathname.replace(/\/$/, "");
  const candidates = [];
  for (const a of anchors) {
    if (!a.visible) continue;
    let u;
    try {
      u = new URL(a.href);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || same(u) || BAD_HREF.test(u.href)) continue;
    const text = (a.text || "").replace(/\s+/g, " ").trim();
    if (BAD_TEXT.test(text)) continue;
    const labelled = APPLY_TEXT.test(text);
    const appPath = APP_PATH.test(u.pathname);
    const rank = labelled && appPath ? 1 : labelled ? 2 : appPath ? 3 : ATS_HOST.test(u.hostname) && u.hostname !== here.hostname ? 4 : 0;
    if (rank) candidates.push({ rank, href: u.href });
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.href ?? null;
}
