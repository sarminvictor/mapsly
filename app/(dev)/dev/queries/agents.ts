import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export async function getAgentInvocations(taskRunId: string) {
  "use cache";
  cacheLife("seconds");
  cacheTag(`dev-task-run-${taskRunId}`);

  // INC-09 follow-up: skip DB during build prerender — Neon WebSocket
  // cannot be established from Vercel\'s build container, which crashes
  // bundle-check + lighthouse. Runtime cache fills on first request.
  if (process.env.NEXT_PHASE === "phase-production-build") return [];


  try {
    return await prisma.agentInvocation.findMany({
      where: { taskRunId },
      orderBy: { startedAt: "asc" },
    });
  } catch {
    return [];
  }
}
