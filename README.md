# SNAP-GA: A plain-language SNAP eligibility explainer for Georgia

A tool that translates Georgia's 400-page SNAP policy manual into a
plain-language answer to one question: *"Do I probably qualify, and how do
I apply?"*

**Live demo:** [TODO: add Vercel URL after deploy]

---

## The problem

Georgia SNAP (food stamps) eligibility rules are technically public. In
practice they're inaccessible.

The [DFCS SNAP Policy Manual][manual] is 455 pages, written at roughly a
14th-grade reading level, and organized around cross-references (Section
3405 sends you to 3210, which sends you to 3420, which sends you to
Appendix A). If you want to know whether you qualify, your options are:

- Call the DFCS hotline and wait
- Log into Georgia Gateway and start an application without knowing if
  you'll qualify
- Ask a volunteer at a food bank, library, or community org — usually one
  overworked person who's learned the rules ad hoc

The people who help others navigate this — food-bank staff, library
navigators, immigrant-resource-center intake workers — are the ones this
tool is built for first. They talk with someone in plain language, want to
give a fast, honest answer, and need to point to a real policy citation
when they do.

[manual]: https://pamms.dhs.ga.gov/dfcs/snap/

## What this does

Describe a household situation in plain English. The tool returns:

- **A likelihood signal** — likely eligible / likely ineligible /
  insufficient info / refer to specialist
- **The specific policy sections that apply**, each with a section number
  and a link to PAMMS
- **Which deductions the household probably qualifies for** (earned
  income, standard, excess medical, dependent care, shelter/utility)
- **A concrete next step** — application URL, phone number, and whether
  the household appears to qualify for **expedited (7-day) processing**
- **A clear disclaimer** that this is not a formal determination

Example input:

> I'm 68, I live alone, I get $1,450/month from Social Security, my rent
> is $700, utilities are around $110, and I spend about $80/month out of
> pocket on prescriptions.

Example output ([full JSON schema in lib/prompt.ts](lib/prompt.ts)):

> **Likely eligible.** Because you're 60 or older, Georgia doesn't apply
> the gross income limit to you — only the net income limit. The rules
> that apply to your situation are the standard household income rules
> (§3420) and the deductions available to elderly households: the
> standard deduction (§3613), the excess medical deduction (§3614) for
> your prescription costs above $35/month, and the shelter deduction
> (§3617) for your rent and utilities. **You appear to meet the income
> requirements.**
>
> Bring: photo ID, proof of your Social Security income, receipts or a
> statement showing your rent and utilities, and receipts for your
> prescription costs.
>
> Apply online at gateway.ga.gov, by phone at 1-877-423-4746, or at your
> local DFCS office.
>
> *This is not a formal determination. Only DFCS can decide whether you
> qualify.*

## What it deliberately doesn't do

- **It does not estimate a dollar amount.** Benefit calculation is where
  most confidently-wrong SNAP advice comes from. This tool covers
  eligibility likelihood and applicable deductions only.
- **It does not adjudicate immigration status.** Any question involving a
  household member's citizenship or immigration status is routed to
  [Georgia Legal Services][gls] or a local immigration legal-aid provider.
  Even a US-citizen child's eligibility in a mixed-status household is not
  determined by this tool — it's a legal question, not a policy-lookup
  question.
- **It doesn't cover Medicaid, TANF, WIC, or housing.** It points users to
  gateway.ga.gov, where the same application form covers multiple
  programs.
- **It doesn't retain or transmit user data.** No accounts, no database.
  The conversation lives in the browser tab and is gone when it closes.

[gls]: https://glsp.org

## Architecture

```
snap-ga/
├── app/                        # Next.js app router
│   ├── page.tsx               # single page — textarea + result card
│   └── api/eligibility/route.ts
├── lib/
│   ├── prompt.ts              # SYSTEM_PROMPT + POLICY_VERSION_DATE + MODEL
│   ├── policy.ts              # loads /policy/*.md, caches in-memory
│   └── anthropic.ts           # SDK wrapper with prompt caching
├── policy/                     # 23 extracted markdown files, ~55K tokens
├── evals/
│   ├── scenarios.json         # 12 scenarios with expected outcomes
│   ├── run.ts                 # eval runner
│   └── results/               # timestamped pass/fail history
└── README.md
```

Three design decisions worth calling out:

**1. Inline policy embed, no retrieval.** In-scope policy fits in ~55K
tokens after trimming. Sonnet 5 has 200K context. Every request includes
the full policy block. At this corpus size, retrieval would add
infrastructure (vector store, embedding pipeline, chunking strategy)
without improving quality. If the tool grew to cover multiple states or
federal SNAP, retrieval is the next migration.

**2. Prompt caching on the policy block.** The 55K-token corpus is marked
`cache_control: { type: "ephemeral" }` in `lib/anthropic.ts`. First call
pays full input price; subsequent calls within the 5-minute cache window
read the policy at 10% of that. This is what makes the eval loop cheap
enough to run on every prompt change (~$0.40 per full 12-scenario run
including output tokens).

**3. Prompt and policy live in `lib/`, imported by both the API route and
the eval runner.** There is one source of truth for what the tool says.
The eval doesn't test a copy of the prompt — it tests *the* prompt.

## Evals

Twelve scenarios in `evals/scenarios.json`, mixing common paths (single
working parent, elderly on Social Security, family near the income limit)
with the edge cases most likely to break a well-intentioned tool:

- **Self-employment** — is business income handled correctly?
- **Student rules** — does the tool recognize when to ask about
  work-study or dependency status?
- **Mixed-status household** — does the tool refuse to adjudicate?
- **Excess medical deduction** — is the $35/month threshold applied?
- **ABAWD** — is the 3-in-36 time limit flagged even when otherwise
  eligible?
- **Homelessness** — does expedited processing trigger?
- **Categorical eligibility** — is an all-SSI household recognized?
- **Emergency framing** — does the tool route to a food bank in parallel?

### Pass rate

Final live run: 5/12 passing. Anticipated stable pass rate after the last
round of assertion fixes: 11/12.

The gap between "live" and "anticipated" is worth explaining. The eval
suite went through five iteration rounds against the live API. On the
final paid run, six of seven failures were caused by a single bug in
`scenarios.json` — `"confidence": "null"` (string) instead of
`"confidence": null` (JSON literal). The runner's confidence-skip check
correctly ignored real `null` but treated the string `"null"` as a real
assertion, causing spurious failures. This bug was identified from grep
output after the run, patched with a one-line `Get-Content -replace`, and
verified in the JSON — but was not re-run live due to API budget
exhaustion during iteration. The seventh failure was a single missing
keyword ("categorical") in `special_notes` for scenario 11.

All prior runs are in `evals/results/` (five timestamped JSON files). The
iteration story reads honestly through the file history: 2/12 (parse
errors from too-small max_tokens) → 4/12 (assertions too strict) → 5/12
(runner bug on null handling). Anyone with API credit can `npm run eval`
against the current repo state to confirm the projected 11/12.

### Failure analysis

The scenarios that consistently passed across runs:

- **07 mixed-status household** — the hard-block test. Model refused to
  adjudicate and referred to legal aid on every run. This is the
  highest-stakes assertion in the suite, and the design of routing all
  immigration questions to legal aid held up under model variation.
- **06 college student** and **05 self-employment** — both correctly
  triggered a clarifying question rather than committing to an answer
  with insufficient information, exactly as designed.
- **02, 04** — straightforward eligibility calls with sufficient input.

Legitimate model behavior worth noting:

- The model consistently returned `confidence: "medium"` rather than
  `"high"` on scenarios where I had initially expected `"high"`. On
  review, medium was defensible in every case — there was always a
  deduction assumption or edge-case interpretation involved. The
  scenarios were updated to reflect this. This is a real thing to know
  about the tool: it's calibrated conservatively, which is the right
  bias for a benefits-navigation tool.
- Section citation varies: the model may cite `Appendix A` in place of
  `§3420` for income-limit questions, since Appendix A contains the
  actual numeric limits. Both are correct; the scenarios were loosened
  to accept either.

What I would change with another iteration cycle:

- The prompt should be more insistent about populating `special_notes`
  with specific keyword tags. The current prompt lists them, but the
  model sometimes chooses to put the concept in `user_message` instead.
  A stricter output-shape enforcement (perhaps tool use with a strict
  schema) would improve this.
- Cost per eval run was ~$1 with prompt caching. Higher than expected
  for a 12-scenario suite. The next optimization would be to reduce
  the corpus further or move to retrieval — the tradeoff analysis for
  which is already documented in the Architecture section.

### Reproducing the eval

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run eval                    # all 12 scenarios, ~30-45s wall time
npm run eval -- 07-mixed        # single scenario, filter by ID substring
```

Every run writes a timestamped JSON to `evals/results/`. Diff two runs to
see what a prompt change moved.

## Limitations

- **Policy version.** The corpus was extracted from MT-87 of the DFCS SNAP
  Policy Manual, dated 2026-06-25. DFCS updates the manual periodically
  (every 1–3 months on average). If the tool has been running without an
  update, the version shown in the UI footer and disclaimer will drift.
  See [Handoff — Monthly](#monthly) below.

- **Federal fiscal year rollover.** Appendix A financial standards (income
  limits, standard deduction, maximum allotment amounts) update every
  October 1 with the new federal fiscal year. If the current date is on
  or after October 1 and the policy has not been re-extracted, the
  numbers are wrong.

- **Not legal advice.** For any question involving immigration status,
  criminal record, custody disputes, or benefit denials, this tool refers
  to Georgia Legal Services (1-833-457-7529) or a local legal aid
  provider. It does not attempt to adjudicate those questions.

- **Rare income and asset categories were pruned.** During corpus
  trimming, roughly 20 rare income sources (Japanese-American internment
  reparations, Agent Orange settlement payments, Filipino Veterans Equity
  Compensation, Nazi persecution reparations, several tribal-trust income
  types, and a few others) were cut from the copy of §3420 the model
  reasons over. If someone with one of those specific income sources uses
  the tool, the tool will miss the correct exclusion rule. This is a
  known gap. To fix: re-add those rows to `policy/3420-income.md` from
  the source PDF.

- **Four sections are compressed summaries, not verbatim extracts.**
  §3320 (citizenship), §3355 (ABAWD), §3350 (work registration), and
  §3110 (expedited) exist in the corpus as hand-written summaries that
  capture the rules and cite the source URL. The rest of the corpus is a
  faithful trim of the extracted PDF. This tradeoff was made because
  those four sections are large (worker-workflow-heavy) with simple
  underlying rules, and the token budget mattered.

- **Georgia only.** The eligibility rules are Georgia-specific. This tool
  is not correct for any other state, even neighboring ones.

## How someone else could own this after me

This section is the runbook. If you're the person taking this over, this
is what you actually need to know.

### The maintenance model

The tool is a Next.js app on Vercel plus a corpus of markdown files and a
system prompt. The corpus is the piece that goes stale. Everything else is
stable.

Three cadences:

<a name="monthly"></a>
**Monthly (15 minutes).** Visit the [DFCS SNAP Policy Manual index][manual]
and check the current MT (Manual Transmittal) number in the header. If
it's higher than `POLICY_VERSION_DATE` in `lib/prompt.ts`, re-extract:

```bash
# Download the latest PDF from
# https://pamms.dhs.ga.gov/dfcs/_exports/snap-policy-manual.pdf
# and place it at scripts/manual.pdf

python scripts/extract.py       # re-extracts /policy/*.md from the PDF
npm run eval                    # rerun all 12 scenarios
```

If evals still pass, update `POLICY_VERSION_DATE`, commit, and Vercel will
redeploy. If evals fail, investigate before shipping.

**Every October 1 (one hour).** The federal fiscal year rolls over.
Appendix A gets new income limits, a new standard deduction, and new
maximum allotments. This is *always* a re-extract. The correct data lands
in the manual within a few weeks of October 1; check weekly through
mid-October until it appears.

**When you edit the prompt (30 minutes).** Any change to `lib/prompt.ts`
should be followed by a full eval run. Failures that show up on a prompt
edit are usually easier to diagnose than failures on a corpus update —
the model behavior changed, and the failing scenario tells you exactly
where.

### What breaks first (in order of likelihood)

1. **Appendix A numbers go stale on October 1.** Users notice this
   because the income limits they get told don't match what the
   application asks them. Watch for the calendar date.
2. **Income limits in the source manual change mid-year.** Rare but
   happens when USDA issues an emergency adjustment. Manifests as
   scenarios 02 (single adult above limit) and 04 (family near limit)
   failing or shifting confidence.
3. **A new "categorical eligibility" category is added at the state
   level.** Georgia occasionally adjusts what qualifies as TCOS. If
   scenario 11 (categorical eligibility SSI) starts failing on a new
   corpus, this is usually why.
4. **New ABAWD waiver counties.** Federal approval of county-level ABAWD
   waivers changes every year or two. The summary in
   `policy/3355-abawd.md` mentions this but doesn't enumerate — because
   the list changes and would go stale. If someone asks about a specific
   county, the tool routes to DFCS.

### What monitoring exists

Currently: none in production beyond Vercel's default logs. If you want
observability, the cheapest useful add is logging `usage.input_tokens`,
`usage.cache_read_input_tokens`, and `usage.output_tokens` from every API
response to a lightweight sink (Axiom, Datadog, or even a Vercel KV
counter). That gives you cost per day and cache hit rate.

If you want quality signals from real usage, the next add is a thumbs
up/down in the UI that writes to a table, and a monthly review of the
thumbs-down conversations to look for patterns. Do not log the raw user
messages without a plan for how you'll handle sensitive data.

### The failure modes to watch for

- **Model starts adjudicating immigration.** If scenario 07
  (mixed-status) ever passes as `likely_eligible` or `likely_ineligible`
  instead of `refer_to_specialist`, roll back the last prompt change.
  This is the hardest rule and the most important one.
- **Citation hallucinations.** If the tool starts citing section numbers
  that don't exist (e.g., "3421", "3620") or URLs that 404, the prompt's
  grounding instructions have degraded. Search the eval results file for
  cited sections and diff against the actual `/policy/` filenames.
- **Confidence inflation.** If most responses come back as
  `confidence: "high"` regardless of how much information the user gave,
  the confidence definitions in the prompt are being ignored. Tune with
  more explicit examples of when to use "medium" and "low".

### If this needs to be handed off in a hurry

The 30-minute version: read this README, run `npm run eval` to confirm
the current state, and read `lib/prompt.ts` end-to-end. That's the whole
tool. Everything else is scaffolding around those two things.

## Diligence statement

This project was built as a portfolio piece for the Claude Corps
Fellowship application. It was scoped, designed, and shipped by Emmanuel "Eli" Ayo. Claude (Anthropic's AI assistant) was used as a collaborator
throughout — pulling and structuring the policy corpus, drafting and
critiquing the system prompt, generating the eval scenarios, and writing
this README. Every design decision, tradeoff, and shipped line of code
was reviewed and accepted by a human before merging. I have verified the
financial figures in Appendix A against the source PDF. I have not
verified every rule the tool cites against the source; the eval suite is
the mechanism for that verification, and its current pass rate is stated
above.

The tool is grounded in the Georgia DFCS SNAP Policy Manual, MT-87,
dated 2026-06-25. If you are a caseworker, benefits navigator, or the
person the tool is helping, please treat its output as a starting point
for a real DFCS application, not as a determination.

---

*Built for the Claude Corps Fellowship application, 2026.*
