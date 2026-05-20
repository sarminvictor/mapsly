import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export async function getAgentInvocations(taskRunId: string) {
  "use cache";
  cacheLife("seconds");
  cacheTag(`dev-task-run-${taskRunId}`);

  try {
    return await prisma.agentInvocation.findMany({
      where: { taskRunId },
      orderBy: { startedAt: "asc" },
    });
  } catch {
    return [];
  }
}
