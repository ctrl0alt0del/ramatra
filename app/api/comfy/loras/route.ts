import { type NextRequest } from "next/server";
import { z } from "zod";

import { listAvailableLoras } from "@/lib/comfy/loras";
import { workflowNames } from "@/lib/comfy/workflows/types";

const querySchema = z.object({
  workflowName: z.enum(workflowNames).optional(),
});

export async function GET(request: NextRequest) {
  const workflowNameRaw = request.nextUrl.searchParams.get("workflowName") ?? undefined;
  const parsed = querySchema.safeParse({ workflowName: workflowNameRaw ?? undefined });

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid query",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await listAvailableLoras({
      workflowName: parsed.data.workflowName,
    });

    return Response.json({
      workflowName: result.workflowName,
      total: result.total,
      items: result.items,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list available LoRAs.",
      },
      { status: 500 },
    );
  }
}
