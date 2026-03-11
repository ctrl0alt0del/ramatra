import { NextResponse } from "next/server";

import {
  forceResumeChatGpuMode,
  getSchedulerSystemState,
} from "@/lib/tasks/gpu-manager";
import { processTaskQueues } from "@/lib/tasks/processor";

export async function POST() {
  try {
    await forceResumeChatGpuMode();
    void processTaskQueues();
    return NextResponse.json(getSchedulerSystemState());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to force resume chat mode.",
        state: getSchedulerSystemState(),
      },
      { status: 500 },
    );
  }
}
