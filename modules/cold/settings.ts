/**
 * Cold-email runtime settings (DB-backed key/value) — drives the admin
 * kill-switch without a redeploy. Env COLD_GLOBAL_PAUSE=1 is a hard override.
 */
import prisma from "@/lib/prisma";

export async function getColdSetting(key: string): Promise<string | null> {
  const row = await prisma.coldSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  return row?.value ?? null;
}

export async function setColdSetting(
  key: string,
  value: string,
): Promise<void> {
  await prisma.coldSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** True when sending is paused — env override OR the admin DB toggle. */
export async function isGloballyPaused(): Promise<boolean> {
  if (process.env.COLD_GLOBAL_PAUSE === "1") return true;
  return (await getColdSetting("globalPause")) === "1";
}
