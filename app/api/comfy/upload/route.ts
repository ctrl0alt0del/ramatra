import { NextRequest } from "next/server";

const withHttpProtocol = (url: string) => {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `http://${url}`;
};

const getComfyBaseUrl = () => {
  const baseUrl = process.env.COMFY_BASE_URL;
  if (!baseUrl) {
    throw new Error("COMFY_BASE_URL is not configured.");
  }

  return withHttpProtocol(baseUrl).replace(/\/$/, "");
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (files.length === 0) {
      return Response.json({ error: "No files uploaded." }, { status: 400 });
    }

    const uploaded: string[] = [];

    for (const file of files) {
      const uploadForm = new FormData();
      uploadForm.append("image", file, file.name || `upload-${Date.now()}.png`);
      uploadForm.append("type", "input");
      uploadForm.append("overwrite", "false");

      const response = await fetch(`${getComfyBaseUrl()}/upload/image`, {
        method: "POST",
        body: uploadForm,
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Comfy upload failed (${response.status}): ${details}`);
      }

      const json = (await response.json()) as { name?: string; subfolder?: string };
      if (!json.name) {
        throw new Error("Comfy upload did not return file name.");
      }

      uploaded.push(json.subfolder?.trim() ? `${json.subfolder}/${json.name}` : json.name);
    }

    return Response.json({ files: uploaded });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to upload images.",
      },
      { status: 500 },
    );
  }
}
