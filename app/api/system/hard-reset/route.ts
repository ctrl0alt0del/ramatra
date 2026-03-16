import { NextResponse } from "next/server";

import {
  getSchedulerSystemState,
  hardResetChatSystem,
} from "@/lib/tasks/gpu-manager";
import { processTaskQueues } from "@/lib/tasks/processor";

export async function POST() {
  try {
    await hardResetChatSystem();
    void processTaskQueues();
    return NextResponse.json(getSchedulerSystemState());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to hard reset chat system.",
        state: getSchedulerSystemState(),
      },
      { status: 500 },
    );
  }
}
