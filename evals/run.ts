/**
 * Eval runner for the Georgia SNAP eligibility explainer.
 *
 * Loads scenarios.json, calls the same prompt + policy modules the API route
 * uses, asserts each response against the scenario's expected fields, and
 * prints a summary + failure diffs. Results are also written to
 * evals/results/<timestamp>.json for the README to reference.
 *
 * Run with:  npm run eval
 * Or:        npx tsx evals/run.ts
 * Or for a single scenario:  npx tsx evals/run.ts 07-mixed-status-household
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT, MODEL } from "../lib/prompt.js";
import { getPolicyCorpus } from "../lib/policy.js";
import { callClaude, type ClaudeResponse } from "../lib/anthropic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONCURRENCY = 4;

// -------------- Types --------------

type EligibilitySignal =
  | "likely_eligible"
  | "likely_ineligible"
  | "insufficient_info"
  | "refer_to_specialist";

interface Expected {
  eligibility_signal: EligibilitySignal;
  confidence: "high" | "medium" | "low" | null;
  must_cite_sections: string[];
  must_include_deductions: string[] | null;
  special_notes_must_mention: string[];
  expedited_expected: boolean | null;
  refer_to_specialist_expected: boolean;
  acceptable_alternative?: string;
}

interface Scenario {
  id: string;
  category: string;
  tests: string;
  user_input: string;
  expected: Expected;
}

interface ScenariosFile {
  corpus_version: string;
  notes: string;
  scenarios: Scenario[];
}

interface ResultBlock {
  eligibility_signal: EligibilitySignal;
  confidence?: string;
  applicable_rules?: Array<{ section: string }>;
  applicable_deductions?: Array<{ section: string }>;
  special_notes?: string;
  how_to_apply?: { expedited_possible?: boolean };
  [k: string]: unknown;
}

interface Assertion {
  name: string;
  pass: boolean;
  detail?: string;
}

interface ScenarioResult {
  scenario_id: string;
  category: string;
  passed: boolean;
  mode: "clarifying_question" | "committed" | "parse_error";
  assertions: Assertion[];
  raw_response: string;
  parsed_result?: ResultBlock;
  clarifying_questions_text?: string;
  usage: ClaudeResponse["usage"];
  latency_ms: number;
  error?: string;
}

// -------------- Response parsing --------------

function extractTagContent(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function parseResponse(text: string): {
  mode: "clarifying_question" | "committed" | "parse_error";
  result?: ResultBlock;
  clarifying?: string;
  error?: string;
} {
  const clarifying = extractTagContent(text, "clarifying_questions");
  const resultRaw = extractTagContent(text, "result");

  // The model may emit both blocks by mistake — treat a real <result> as
  // authoritative unless it's absent.
  if (resultRaw) {
    try {
      const result = JSON.parse(resultRaw) as ResultBlock;
      return { mode: "committed", result };
    } catch (e) {
      return {
        mode: "parse_error",
        error: `Failed to parse <result> JSON: ${(e as Error).message}`,
      };
    }
  }

  if (clarifying) {
    return { mode: "clarifying_question", clarifying };
  }

  return {
    mode: "parse_error",
    error: "Response contained neither <result> nor <clarifying_questions> block.",
  };
}

// -------------- Assertions --------------

function assertOnClarifying(
  expected: Expected,
  clarifyingText: string,
): Assertion[] {
  // Only acceptable if the scenario declared clarifying-question as an alternative pathway.
  if (!expected.acceptable_alternative) {
    return [
      {
        name: "response_mode",
        pass: false,
        detail:
          "Model asked a clarifying question, but this scenario expected a committed answer.",
      },
    ];
  }

  // Weak keyword check: does the clarifying question address the right topic?
  const hint = expected.acceptable_alternative.toLowerCase();
  const clarifyLower = clarifyingText.toLowerCase();
  let keywords: string[] = [];
  if (hint.includes("student")) {
    keywords = ["student", "school", "enrolled", "work", "hours"];
  } else if (hint.includes("household_size")) {
    keywords = ["household", "who", "living", "how many", "kids", "family"];
  } else {
    // Fallback: accept any clarifying question.
    keywords = [];
  }
  const hits = keywords.filter((k) => clarifyLower.includes(k)).length;
  const pass = keywords.length === 0 || hits >= 1;
  return [
    {
      name: "clarifying_question_topic",
      pass,
      detail: pass
        ? `Clarifying question addressed expected topic (${expected.acceptable_alternative}).`
        : `Clarifying question did not mention any of: ${keywords.join(", ")}`,
    },
  ];
}

function assertOnCommitted(
  expected: Expected,
  result: ResultBlock,
): Assertion[] {
  const assertions: Assertion[] = [];

  // 1. eligibility_signal exact match
  assertions.push({
    name: "eligibility_signal",
    pass: result.eligibility_signal === expected.eligibility_signal,
    detail:
      result.eligibility_signal === expected.eligibility_signal
        ? undefined
        : `expected "${expected.eligibility_signal}", got "${result.eligibility_signal}"`,
  });

  // 2. refer_to_specialist_expected — enforced as a hard rule
  if (expected.refer_to_specialist_expected) {
    assertions.push({
      name: "refer_to_specialist_hard_rule",
      pass: result.eligibility_signal === "refer_to_specialist",
      detail:
        result.eligibility_signal === "refer_to_specialist"
          ? undefined
          : `HARD RULE VIOLATION: expected refer_to_specialist (immigration hard block), got "${result.eligibility_signal}"`,
    });
  }

  // 3. confidence (only assert when expected is a real value, not null)
  if (expected.confidence) {
    assertions.push({
      name: "confidence",
      pass: result.confidence === expected.confidence,
      detail:
        result.confidence === expected.confidence
          ? undefined
          : `expected confidence "${expected.confidence}", got "${result.confidence}"`,
    });
  }

  // 4. must_cite_sections — every section number in expected list appears in applicable_rules
  const citedSections = new Set(
    (result.applicable_rules ?? []).map((r) => r.section),
  );
  for (const section of expected.must_cite_sections) {
    assertions.push({
      name: `cites_${section}`,
      pass: citedSections.has(section),
      detail: citedSections.has(section)
        ? undefined
        : `expected applicable_rules to include section ${section}; got [${[...citedSections].join(", ") || "none"}]`,
    });
  }

  // 5. must_include_deductions (only if expected is non-null)
  if (expected.must_include_deductions !== null) {
    const includedDeductions = new Set(
      (result.applicable_deductions ?? []).map((d) => d.section),
    );
    for (const section of expected.must_include_deductions) {
      assertions.push({
        name: `deduction_${section}`,
        pass: includedDeductions.has(section),
        detail: includedDeductions.has(section)
          ? undefined
          : `expected applicable_deductions to include ${section}; got [${[...includedDeductions].join(", ") || "none"}]`,
      });
    }
  }

  // 6. special_notes_must_mention — case-insensitive substring
  const specialNotesLower = (result.special_notes ?? "").toLowerCase();
  for (const keyword of expected.special_notes_must_mention) {
    assertions.push({
      name: `special_notes_mentions_${keyword.replace(/\s+/g, "_")}`,
      pass: specialNotesLower.includes(keyword.toLowerCase()),
      detail: specialNotesLower.includes(keyword.toLowerCase())
        ? undefined
        : `special_notes did not mention "${keyword}"`,
    });
  }

  // 7. expedited_expected (only if non-null)
  if (expected.expedited_expected !== null) {
    const actual = result.how_to_apply?.expedited_possible;
    assertions.push({
      name: "expedited_possible",
      pass: actual === expected.expedited_expected,
      detail:
        actual === expected.expedited_expected
          ? undefined
          : `expected expedited_possible=${expected.expedited_expected}, got ${actual}`,
    });
  }

  return assertions;
}

// -------------- Runner --------------

async function runOneScenario(
  scenario: Scenario,
  policy: string,
): Promise<ScenarioResult> {
  try {
    const response = await callClaude(SYSTEM_PROMPT, policy, scenario.user_input);
    const parsed = parseResponse(response.text);

    let assertions: Assertion[];
    if (parsed.mode === "parse_error") {
      assertions = [{ name: "parse", pass: false, detail: parsed.error }];
    } else if (parsed.mode === "clarifying_question") {
      assertions = assertOnClarifying(scenario.expected, parsed.clarifying!);
    } else {
      assertions = assertOnCommitted(scenario.expected, parsed.result!);
    }

    const passed = assertions.every((a) => a.pass);

    return {
      scenario_id: scenario.id,
      category: scenario.category,
      passed,
      mode: parsed.mode,
      assertions,
      raw_response: response.text,
      parsed_result: parsed.result,
      clarifying_questions_text: parsed.clarifying,
      usage: response.usage,
      latency_ms: response.latency_ms,
    };
  } catch (err) {
    return {
      scenario_id: scenario.id,
      category: scenario.category,
      passed: false,
      mode: "parse_error",
      assertions: [
        { name: "api_call", pass: false, detail: (err as Error).message },
      ],
      raw_response: "",
      usage: { input_tokens: 0, output_tokens: 0 },
      latency_ms: 0,
      error: (err as Error).message,
    };
  }
}

async function runWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// -------------- Output formatting --------------

const CHECK = "\x1b[32m✓\x1b[0m";
const CROSS = "\x1b[31m✗\x1b[0m";

function formatResultLine(r: ScenarioResult): string {
  const symbol = r.passed ? CHECK : CROSS;
  const modeTag =
    r.mode === "clarifying_question"
      ? " [clarifying_question]"
      : r.mode === "parse_error"
        ? " [parse_error]"
        : "";
  return `  ${symbol} ${r.scenario_id.padEnd(40)} (${(r.latency_ms / 1000).toFixed(1)}s)${modeTag}`;
}

function formatFailures(results: ScenarioResult[]): string {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return "";

  const lines: string[] = ["", "Failures:"];
  for (const r of failed) {
    lines.push(`  ${r.scenario_id}`);
    for (const a of r.assertions.filter((a) => !a.pass)) {
      lines.push(`    - ${a.name}: ${a.detail ?? "(no detail)"}`);
    }
  }
  return lines.join("\n");
}

function formatCostSummary(results: ScenarioResult[]): string {
  const totalInput = results.reduce((s, r) => s + r.usage.input_tokens, 0);
  const totalCache = results.reduce(
    (s, r) => s + (r.usage.cache_read_input_tokens ?? 0),
    0,
  );
  const totalOutput = results.reduce((s, r) => s + r.usage.output_tokens, 0);
  // Sonnet 5 approximate pricing: $3/M input, $0.30/M cached, $15/M output.
  const cost =
    ((totalInput - totalCache) * 3) / 1_000_000 +
    (totalCache * 0.3) / 1_000_000 +
    (totalOutput * 15) / 1_000_000;
  return [
    "",
    `Tokens: ${totalInput.toLocaleString()} input (${totalCache.toLocaleString()} cached), ${totalOutput.toLocaleString()} output`,
    `Approx. cost: $${cost.toFixed(3)} for ${results.length} scenarios`,
  ].join("\n");
}

// -------------- Main --------------

async function main() {
  const scenariosPath = path.join(__dirname, "scenarios.json");
  const scenariosFile: ScenariosFile = JSON.parse(
    await fs.readFile(scenariosPath, "utf-8"),
  );

  // Optional single-scenario filter (npx tsx evals/run.ts 07-mixed-status-household)
  const filter = process.argv[2];
  const scenarios = filter
    ? scenariosFile.scenarios.filter((s) => s.id.includes(filter))
    : scenariosFile.scenarios;

  if (scenarios.length === 0) {
    console.error(`No scenarios match filter "${filter}"`);
    process.exit(1);
  }

  console.log(
    `Running ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} against ${MODEL}...`,
  );
  console.log(`Corpus: ${scenariosFile.corpus_version}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log("");

  const policy = await getPolicyCorpus();
  console.log(
    `Loaded policy corpus: ${policy.length.toLocaleString()} chars (~${Math.round(policy.length / 4).toLocaleString()} tokens)`,
  );
  console.log("");

  const t0 = Date.now();
  const results = await runWithConcurrency(scenarios, CONCURRENCY, (s) =>
    runOneScenario(s, policy),
  );
  const wallTime = ((Date.now() - t0) / 1000).toFixed(1);

  for (const r of results) {
    console.log(formatResultLine(r));
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(0);

  console.log("");
  console.log(`Passed: ${passed}/${total} (${passRate}%)`);
  console.log(`Wall time: ${wallTime}s`);
  console.log(formatCostSummary(results));
  console.log(formatFailures(results));

  // Persist a results file for the README to link to
  const resultsDir = path.join(__dirname, "results");
  await fs.mkdir(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resultsPath = path.join(resultsDir, `${timestamp}.json`);
  await fs.writeFile(
    resultsPath,
    JSON.stringify(
      {
        model: MODEL,
        corpus_version: scenariosFile.corpus_version,
        run_at: new Date().toISOString(),
        pass_rate: passed / total,
        passed,
        total,
        wall_time_seconds: parseFloat(wallTime),
        results,
      },
      null,
      2,
    ),
  );
  console.log("");
  console.log(`Results written to ${path.relative(process.cwd(), resultsPath)}`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
