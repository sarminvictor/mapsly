// GitHub API queries for the dev dashboard.
// Token is server-side only (GITHUB_TOKEN). Never expose to client.
// Cached aggressively · revalidated by `dev-dashboard` tag.

import { cacheLife, cacheTag } from "next/cache";

const REPO = "sarminvictor/mapsly";
const API = "https://api.github.com";

interface GhCommit {
  sha: string;
  short: string;
  author: string;
  message: string;
  url: string;
  date: string;
}

interface GhPr {
  number: number;
  title: string;
  author: string;
  url: string;
  createdAt: string;
  labels: string[];
  state: "open" | "closed" | "merged";
}

async function gh<T>(path: string): Promise<T | null> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-github");

  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getRecentCommits(limit = 8): Promise<GhCommit[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-github");

  type RawCommit = {
    sha: string;
    commit: { author: { name: string; date: string }; message: string };
    html_url: string;
  };

  const data = await gh<RawCommit[]>(
    `/repos/${REPO}/commits?per_page=${limit}`,
  );
  if (!data) return [];

  return data.map((c) => ({
    sha: c.sha,
    short: c.sha.slice(0, 7),
    author: c.commit.author.name,
    message: c.commit.message.split("\n")[0].slice(0, 90),
    url: c.html_url,
    date: c.commit.author.date,
  }));
}

export async function getOpenPrs(): Promise<GhPr[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-github");

  type RawPr = {
    number: number;
    title: string;
    user: { login: string };
    html_url: string;
    created_at: string;
    labels: { name: string }[];
    state: string;
    merged_at: string | null;
  };

  const data = await gh<RawPr[]>(`/repos/${REPO}/pulls?state=open&per_page=20`);
  if (!data) return [];

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user.login,
    url: pr.html_url,
    createdAt: pr.created_at,
    labels: pr.labels.map((l) => l.name),
    state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
  }));
}

export async function getRecentMerges(limit = 5): Promise<GhPr[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-github");

  type RawPr = {
    number: number;
    title: string;
    user: { login: string };
    html_url: string;
    created_at: string;
    merged_at: string | null;
    labels: { name: string }[];
    state: string;
  };

  const data = await gh<RawPr[]>(
    `/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=${limit * 3}`,
  );
  if (!data) return [];

  return data
    .filter((pr) => pr.merged_at)
    .slice(0, limit)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      url: pr.html_url,
      createdAt: pr.merged_at!,
      labels: pr.labels.map((l) => l.name),
      state: "merged" as const,
    }));
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
