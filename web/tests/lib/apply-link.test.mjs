// Run:  node --test tests/lib/apply-link.test.mjs
// Anchors below are the real ones read from each page on 2026-10-12.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickApplyHref } from "../../src/lib/apply/apply-link.mjs";

const v = (href, text) => ({ href, text, visible: true });

test("Lever: APPLY link, not the company logo that lists every job", () => {
  const page = "https://jobs.lever.co/palantir/2aa14e4f-d406-486e-9aa8-6ff3358d70a0";
  const anchors = [
    v("https://jobs.lever.co/palantir", ""),
    v(`${page}/apply`, "APPLY"),
    v(`${page}/apply`, "APPLY"),
    v("https://www.lever.co/job-seeker-support/", "Jobs powered by"),
  ];
  assert.equal(pickApplyHref(anchors, page), `${page}/apply`);
});

test("Greenhouse board: never 'Create alert' (a sign-in page) or another posting", () => {
  const page = "https://job-boards.greenhouse.io/anthropic";
  const anchors = [
    v("https://my.greenhouse.io/users/sign_in?job_board=anthropic&source=job_alert_board", "Create alert"),
    v("https://job-boards.greenhouse.io/anthropic/jobs/5183044008", "Anthropic Fellows Program, AI Safety"),
  ];
  assert.equal(pickApplyHref(anchors, page), null);
});

test("company careers page → ATS application on another host", () => {
  const anchors = [v("https://openai.com/careers", "Careers"), v("https://jobs.ashbyhq.com/openai/abc/application", "Apply now")];
  assert.equal(pickApplyHref(anchors, "https://openai.com/careers/research-engineer"), "https://jobs.ashbyhq.com/openai/abc/application");
});

test("an unlabelled ATS link counts only when it leaves the current host", () => {
  const off = [v("https://boards.greenhouse.io/acme/jobs/1", "")];
  assert.equal(pickApplyHref(off, "https://acme.com/jobs/1"), "https://boards.greenhouse.io/acme/jobs/1");
  const on = [v("https://jobs.lever.co/acme", "")];
  assert.equal(pickApplyHref(on, "https://jobs.lever.co/acme/123"), null);
});

test("skips hidden, submit-like and same-page links", () => {
  const page = "https://acme.com/jobs/1";
  const anchors = [
    { href: "https://acme.com/jobs/1/apply", text: "Apply", visible: false },
    v("https://acme.com/jobs/1/apply?submit=1", "Apply"),
    v("https://acme.com/jobs/1", "Apply"),
    v("https://acme.com/applied", "Applied"),
  ];
  assert.equal(pickApplyHref(anchors, page), null);
});

test("a labelled application path beats a bare labelled link", () => {
  const anchors = [v("https://acme.com/how-to-apply", "How to apply"), v("https://acme.com/jobs/1/application", "Apply for this job")];
  assert.equal(pickApplyHref(anchors, "https://acme.com/jobs/1"), "https://acme.com/jobs/1/application");
});
