import { type NextRequest } from "next/server";
import { z } from "zod";

import { deleteAvailableLora, listAvailableLoras } from "@/lib/comfy/loras";
import { workflowNames } from "@/lib/comfy/workflows/types";

const querySchema = z.object({
  workflowName: z.enum(workflowNames).optional(),
});

const deleteSchema = z.object({
  name: z.string().min(1),
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

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: "Invalid JSON body.",
      },
      { status: 400 },
    );
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request body.",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await deleteAvailableLora(parsed.data.name);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete LoRA file.",
      },
      { status: 500 },
    );
  }
}
