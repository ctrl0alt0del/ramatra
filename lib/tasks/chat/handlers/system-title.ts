import { generateThreadTitle } from "@/lib/lmstudio/title";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeSystemTitleTask = async ({
  task,
}: {
  task: ChatTask;
}) => {
  if (task.payload.kind !== "generate_title") {
    throw new Error("chat.title task requires generate_title payload.");
  }
  const thread = threadRepository.getById(task.payload.threadId);
  if (!thread) {
    throw new Error("Thread not found.");
  }

  if (thread.titleGenerated && !threadRepository.isPlaceholderTitle(thread.title)) {
    taskRepository.updateRunningTask(task.id, {
      result: {
        title: thread.title,
      },
    });
  } else {
    const inferredTitle = await generateThreadTitle(thread);
    const nextTitle = inferredTitle || thread.title || "New Chat";
    const updatedThread = threadRepository.updateById(task.payload.threadId, {
      title: nextTitle,
      titleGenerated: !threadRepository.isPlaceholderTitle(nextTitle),
    });

    taskRepository.updateRunningTask(task.id, {
      result: {
        title: updatedThread?.title ?? nextTitle,
      },
    });
  }

  taskRepository.setGroupTaskStatusByKind({
    taskId: task.id,
    kind: "chat.title",
    status: "completed",
  });
  return true;
};
