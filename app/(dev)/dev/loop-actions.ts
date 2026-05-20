"use server";

import { revalidateTag } from "next/cache";

const REPO = "sarminvictor/mapsly";
const FILE_PATH = ".claude/memory/loop-lock.json";
const API = "https://api.github.com";

interface LoopLock {
  state: "idle" | "running" | "cooldown" | "paused";
  sessionId: string | null;
  startedAt: string | null;
  lastTickAt: string;
  cooldownUntil: string | null;
  consecutiveFailures: number;
  note?: string;
}

async function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN missing");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getCurrent(): Promise<{ lock: LoopLock; sha: string } | null> {
  const headers = await authHeaders();
  const res = await fetch(`${API}/repos/${REPO}/contents/${FILE_PATH}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { content: string; sha: string };
  const decoded = Buffer.from(data.content, "base64").toString("utf-8");
  return { lock: JSON.parse(decoded), sha: data.sha };
}

async function writeLock(lock: LoopLock, sha: string, message: string) {
  const headers = await authHeaders();
  const body = {
    message,
    content: Buffer.from(JSON.stringify(lock, null, 2) + "\n").toString(
      "base64",
    ),
    sha,
    committer: {
      name: "Mapsly Dashboard",
      email: "sarminvictor@gmail.com",
    },
  };
  const res = await fetch(`${API}/repos/${REPO}/contents/${FILE_PATH}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `GitHub write failed: ${res.status} · ${err.slice(0, 200)}`,
    );
  }
}

async function setState(newState: LoopLock["state"], note: string) {
  const current = await getCurrent();
  if (!current) throw new Error("Could not read current lock");
  const updated: LoopLock = {
    ...current.lock,
    state: newState,
    lastTickAt: new Date().toISOString(),
    note,
    // Clear cooldown when explicitly resumed
    cooldownUntil: newState === "idle" ? null : current.lock.cooldownUntil,
  };
  await writeLock(
    updated,
    current.sha,
    `chore(loop): ${newState} via dashboard`,
  );
  revalidateTag("dev-dashboard-content", "seconds");
  revalidateTag("dev-dashboard-loop", "seconds");
}

export async function pauseLoop() {
  await setState("paused", "Paused via dashboard. Resume to continue.");
}

export async function resumeLoop() {
  await setState("idle", "Resumed via dashboard.");
}

export async function clearCooldown() {
  const current = await getCurrent();
  if (!current) throw new Error("Could not read current lock");
  const updated: LoopLock = {
    ...current.lock,
    state: current.lock.state === "cooldown" ? "idle" : current.lock.state,
    cooldownUntil: null,
    consecutiveFailures: 0,
    lastTickAt: new Date().toISOString(),
    note: "Cooldown cleared via dashboard.",
  };
  await writeLock(
    updated,
    current.sha,
    "chore(loop): cooldown cleared via dashboard",
  );
  revalidateTag("dev-dashboard-content", "seconds");
  revalidateTag("dev-dashboard-loop", "seconds");
}
