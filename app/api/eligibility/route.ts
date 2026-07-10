import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "@/lib/prompt";
import { getPolicyCorpus } from "@/lib/policy";
import { callClaude } from "@/lib/anthropic";

// Very basic per-IP rate limit. Fine for a demo. For production replace
// with Vercel KV or Upstash Redis so it survives cold starts.
const requests = new Map<string, number[]>();
const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = (requests.get(ip) ?? []).filter(
    (t) => now - t < WINDOW_MS,
  );
  if (timestamps.length >= LIMIT) return false;
  timestamps.push(now);
  requests.set(ip, timestamps);
  return true;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in an hour." },
      { status: 429 },
    );
  }

  let message: string;
  try {
    const body = (await req.json()) as { message?: string };
    message = body.message;
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0 ||
      message.length > 5000
    ) {
      return NextResponse.json(
        { error: "Message must be a non-empty string under 5000 characters." },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const policy = await getPolicyCorpus();
    const response = await callClaude(SYSTEM_PROMPT, policy, message);
    return NextResponse.json({ text: response.text });
  } catch (err) {
    console.error("[eligibility] API error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

// Node runtime (not edge) — we need filesystem access for the policy loader.
export const runtime = "nodejs";
export const maxDuration = 60;
