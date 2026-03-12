import { NextResponse } from "next/server";

import { getSystemMonitorSnapshot } from "@/lib/system/monitor";

export async function GET() {
  return NextResponse.json(await getSystemMonitorSnapshot());
}
