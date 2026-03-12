import { NextResponse } from "next/server";

import { getSchedulerSystemState } from "@/lib/tasks/gpu-manager";

export async function GET() {
  return NextResponse.json(getSchedulerSystemState());
}
