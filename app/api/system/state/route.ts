import { NextResponse } from "next/server";

import { getVramBalancerState } from "@/lib/vram/balancer";

export async function GET() {
  return NextResponse.json(getVramBalancerState());
}
