// Read the current loop lock state from the repo via GitHub raw API.

import { cacheLife, cacheTag } from "next/cache";
import { fetchRaw } from "./github-content";

export interface LoopLock {
  state: "idle" | "running" | "cooldown" | "paused";
  sessionId: string | null;
  startedAt: string | null;
  lastTickAt: string;
  cooldownUntil: string | null;
  consecutiveFailures: number;
  note?: string;
}

export async function getLoopState(): Promise<LoopLock | null> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-loop");

  const text = await fetchRaw(".claude/memory/loop-lock.json");
  if (!text) return null;
  try {
    return JSON.parse(text) as LoopLock;
  } catch {
    return null;
  }
}
