import { NextResponse } from "next/server";

import {
  forceResumeChatMode,
  getVramBalancerState,
} from "@/lib/vram/balancer";

export async function POST() {
  try {
    await forceResumeChatMode();
    return NextResponse.json(getVramBalancerState());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to force resume chat mode.",
        state: getVramBalancerState(),
      },
      { status: 500 },
    );
  }
}
