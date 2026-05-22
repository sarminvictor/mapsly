"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";

import { assertAdmin } from "@/lib/portal-guard";
const TaskStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "BLOCKED",
  "SKIPPED",
  "FAILED",
  "HUMAN_REQUIRED",
]);

const EditTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  effort: z.enum(["S", "M", "L", "XL"]).optional(),
  status: TaskStatusSchema.optional(),
  deps: z.string().optional(),
  tags: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
});

const CreateTaskSchema = z.object({
  id: z.string().regex(/^[A-Z0-9][A-Za-z0-9.\-_]*$/),
  groupId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  effort: z.enum(["S", "M", "L", "XL"]).default("M"),
  deps: z.string().optional(),
  tags: z.string().optional(),
});

function invalidate(taskId?: string) {
  revalidateTag("dev-dashboard-plan", "seconds");
  if (taskId) revalidateTag(`dev-task-${taskId}`, "seconds");
}

export async function updateTask(input: z.infer<typeof EditTaskSchema>) {
  await assertAdmin();
  const parsed = EditTaskSchema.parse(input);
  const { id, ...rest } = parsed;
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) throw new Error(`Task ${id} not found`);
  const becameNewlyDone = rest.status === "DONE" && existing.status !== "DONE";
  await prisma.task.update({
    where: { id },
    data: {
      ...rest,
      completedAt: becameNewlyDone
        ? new Date()
        : rest.status && rest.status !== "DONE"
          ? null
          : existing.completedAt,
      startedAt:
        rest.status === "IN_PROGRESS" && !existing.startedAt
          ? new Date()
          : existing.startedAt,
    },
  });
  invalidate(id);
}

export async function createTask(input: z.infer<typeof CreateTaskSchema>) {
  await assertAdmin();
  const parsed = CreateTaskSchema.parse(input);
  const group = await prisma.taskGroup.findUnique({
    where: { id: parsed.groupId },
  });
  if (!group) throw new Error(`Group ${parsed.groupId} not found`);
  const lastInGroup = await prisma.task.findFirst({
    where: { groupId: parsed.groupId },
    orderBy: { sortOrder: "desc" },
  });
  await prisma.task.create({
    data: {
      ...parsed,
      sortOrder: (lastInGroup?.sortOrder ?? -1) + 1,
    },
  });
  invalidate();
}

export async function deleteTask(id: string) {
  await assertAdmin();
  // Soft-delete via SKIPPED status so we keep run history.
  await prisma.task.update({
    where: { id },
    data: { status: "SKIPPED", completedAt: null },
  });
  invalidate(id);
}

// Quick status flips for the inline buttons on /dev/tasks
export async function setStatus(
  id: string,
  status: z.infer<typeof TaskStatusSchema>,
) {
  await assertAdmin();
  await updateTask({ id, status });
}
