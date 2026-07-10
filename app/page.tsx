"use client";
import { useState } from "react";

interface Result {
  eligibility_signal: string;
  confidence?: string;
  reasoning_summary?: string;
  applicable_rules?: Array<{
    section: string;
    url: string;
    name: string;
    plain_language: string;
  }>;
  applicable_deductions?: Array<{
    section: string;
    url: string;
    name: string;
    why_it_applies: string;
  }>;
  documents_needed?: string[];
  special_notes?: string;
  how_to_apply?: {
    expedited_possible?: boolean;
    expedited_reason?: string | null;
    channels?: string[];
    next_step?: string;
  };
  disclaimer?: string;
}

function parseResponse(text: string): {
  result?: Result;
  clarifying?: string;
  userMessage?: string;
} {
  const resultMatch = text.match(/<result>([\s\S]*?)<\/result>/);
  const clarifyingMatch = text.match(
    /<clarifying_questions>([\s\S]*?)<\/clarifying_questions>/,
  );
  const userMatch = text.match(/<user_message>([\s\S]*?)<\/user_message>/);

  const out: {
    result?: Result;
    clarifying?: string;
    userMessage?: string;
  } = {};
  if (resultMatch) {
    try {
      out.result = JSON.parse(resultMatch[1].trim());
    } catch {}
  }
  if (clarifyingMatch) out.clarifying = clarifyingMatch[1].trim();
  if (userMatch) out.userMessage = userMatch[1].trim();
  return out;
}

const signalStyle: Record<string, string> = {
  likely_eligible: "text-green-800 bg-green-50 border-green-200",
  likely_ineligible: "text-red-800 bg-red-50 border-red-200",
  insufficient_info: "text-amber-800 bg-amber-50 border-amber-200",
  refer_to_specialist: "text-blue-800 bg-blue-50 border-blue-200",
};

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseResponse> | null>(
    null,
  );

  async function submit() {
    setLoading(true);
    setError(null);
    setParsed(null);
    try {
      const res = await fetch("/api/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
      }
      const data = await res.json();
      setParsed(parseResponse(data.text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">SNAP-GA</h1>
        <p className="text-gray-600 text-sm mt-1">
          Describe your household in plain English. Get a likely-eligibility
          answer, the policy rules that apply, and how to apply.
        </p>
        <p className="text-gray-500 text-xs mt-2 italic">
          Not a formal determination. Only Georgia DFCS can decide whether you
          qualify.
        </p>
      </header>

      <div className="mb-4">
        <label htmlFor="input" className="block text-sm font-medium mb-2">
          Your situation
        </label>
        <textarea
          id="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g., I'm a single mom in Atlanta with two kids under 10. I work at a daycare making about $1,900/month before taxes. My rent is $850, utilities around $180."
          className="w-full p-3 border border-gray-300 rounded-md h-40 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
          maxLength={5000}
        />
      </div>

      <button
        onClick={submit}
        disabled={loading || !input.trim()}
        className="px-4 py-2 bg-black text-white rounded-md disabled:opacity-40 hover:bg-gray-800"
      >
        {loading ? "Thinking (may take 10-20 seconds)..." : "Check eligibility"}
      </button>

      {error && (
        <p className="mt-4 text-red-700 text-sm">
          Something went wrong: {error}
        </p>
      )}

      {parsed?.clarifying && (
        <div className="mt-6 p-4 border border-amber-200 bg-amber-50 rounded-md">
          <p className="font-medium mb-2">I need to ask you something first:</p>
          <p className="whitespace-pre-wrap text-sm">{parsed.clarifying}</p>
        </div>
      )}

      {parsed?.result && (
        <div className="mt-6 space-y-5">
          <div
            className={`p-4 border rounded-md ${signalStyle[parsed.result.eligibility_signal] ?? "border-gray-200"}`}
          >
            <p className="font-semibold text-lg capitalize">
              {parsed.result.eligibility_signal.replace(/_/g, " ")}
              {parsed.result.confidence && (
                <span className="text-sm font-normal ml-2 opacity-80">
                  ({parsed.result.confidence} confidence)
                </span>
              )}
            </p>
            {parsed.result.reasoning_summary && (
              <p className="mt-2 text-sm">{parsed.result.reasoning_summary}</p>
            )}
          </div>

          {parsed.userMessage && (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-md whitespace-pre-wrap text-sm">
              {parsed.userMessage}
            </div>
          )}

          {parsed.result.how_to_apply && (
            <div>
              <h2 className="font-semibold mb-2">How to apply</h2>
              {parsed.result.how_to_apply.expedited_possible && (
                <p className="text-green-800 bg-green-50 border border-green-200 p-3 rounded-md text-sm mb-3">
                  <strong>You may qualify for expedited (7-day) processing.</strong>{" "}
                  {parsed.result.how_to_apply.expedited_reason}
                </p>
              )}
              <ul className="text-sm space-y-1 list-disc list-inside">
                {parsed.result.how_to_apply.channels?.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {parsed.result.how_to_apply.next_step && (
                <p className="mt-3 font-medium text-sm">
                  Next step: {parsed.result.how_to_apply.next_step}
                </p>
              )}
            </div>
          )}

          {parsed.result.applicable_rules &&
            parsed.result.applicable_rules.length > 0 && (
              <div>
                <h2 className="font-semibold mb-2">Rules that apply</h2>
                <ul className="space-y-3">
                  {parsed.result.applicable_rules.map((r) => (
                    <li key={r.section} className="text-sm">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        §{r.section} — {r.name}
                      </a>
                      <div className="text-gray-700 mt-1">
                        {r.plain_language}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {parsed.result.applicable_deductions &&
            parsed.result.applicable_deductions.length > 0 && (
              <div>
                <h2 className="font-semibold mb-2">Deductions that likely apply</h2>
                <ul className="space-y-3">
                  {parsed.result.applicable_deductions.map((d) => (
                    <li key={d.section} className="text-sm">
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        §{d.section} — {d.name}
                      </a>
                      <div className="text-gray-700 mt-1">{d.why_it_applies}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {parsed.result.documents_needed &&
            parsed.result.documents_needed.length > 0 && (
              <div>
                <h2 className="font-semibold mb-2">Bring with you</h2>
                <ul className="text-sm list-disc list-inside space-y-1">
                  {parsed.result.documents_needed.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

          {parsed.result.special_notes && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm">
              <strong>Note:</strong> {parsed.result.special_notes}
            </div>
          )}

          {parsed.result.disclaimer && (
            <p className="text-xs text-gray-500 mt-4 italic border-t pt-3">
              {parsed.result.disclaimer}
            </p>
          )}
        </div>
      )}

      <footer className="mt-12 pt-6 border-t border-gray-200 text-xs text-gray-500">
        <p>
          Grounded in the Georgia DFCS SNAP Policy Manual (MT-87, June 2026).{" "}
          <a
            href="https://github.com/YOUR_USERNAME/snap-ga"
            className="underline"
          >
            Source on GitHub
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
