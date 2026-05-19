// Generic GitHub Contents + Raw API fetchers used by the dev dashboard.
// Files live on `main` in github.com/sarminvictor/mapsly. We read them live
// via the API so the dashboard reflects whatever's on main right now.

import { cacheLife, cacheTag } from "next/cache";

const REPO = "sarminvictor/mapsly";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const API = "https://api.github.com";

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return {
    Authorization: token ? `Bearer ${token}` : "",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchRaw(path: string): Promise<string | null> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-content");

  try {
    const res = await fetch(`${RAW_BASE}/${path}`, {
      headers: { Authorization: authHeaders().Authorization },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function listDir(path: string): Promise<string[]> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-content");

  try {
    const res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ name: string; type: string }>;
    return data.filter((e) => e.type === "file").map((e) => e.name);
  } catch {
    return [];
  }
}
