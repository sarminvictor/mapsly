// Auto-enhance signals · written by process-enhancer agent into
// .claude/memory/enhance-signals.json when it detects a recurring pattern
// across sessions/incidents.

import { cacheLife, cacheTag } from "next/cache";
import { fetchRaw } from "./github-content";

export interface EnhanceSignal {
  id: string;
  category: string;
  detected: string;
  severity: "info" | "warn" | "error";
  headline: string;
  evidence: string;
  action: string;
  prDrafted?: boolean;
  prUrl?: string;
}

export async function getEnhanceSignals(): Promise<EnhanceSignal[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-enhance");

  const text = await fetchRaw(".claude/memory/enhance-signals.json");
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.slice(-12).reverse(); // newest first, max 12
  } catch {
    return [];
  }
}
