import dotenv from "dotenv";
import { spawn } from "child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

const civitaiEnabled = process.env.CIVITAI_MCP_ENABLED === "true";
const civitaiWorkdir = process.env.CIVITAI_MCP_WORKDIR;
const civitaiCommand = process.env.CIVITAI_MCP_START_CMD ?? "pnpm";
const civitaiArgs = process.env.CIVITAI_MCP_START_ARGS?.split(" ").filter(
  Boolean,
) ?? ["start:http"];

if (!civitaiEnabled) {
  console.log("[mcp:civitai] disabled");
  process.exit(0);
}

if (!civitaiWorkdir) {
  console.error("[mcp:civitai] CIVITAI_MCP_WORKDIR is not set");
  process.exit(1);
}

if (!process.env.CIVITAI_API_KEY) {
  console.error("[mcp:civitai] CIVITAI_API_KEY is not set");
  process.exit(1);
}

console.log(
  `[mcp:civitai] starting "${civitaiCommand} ${civitaiArgs.join(" ")}" in ${civitaiWorkdir}`,
);

const child = spawn(civitaiCommand, civitaiArgs, {
  cwd: civitaiWorkdir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    CIVITAI_API_KEY: process.env.CIVITAI_API_KEY,
  },
});

child.on("error", (error) => {
  console.error("[mcp:civitai] failed to start", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[mcp:civitai] exited due to signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});

for (const event of ["SIGINT", "SIGTERM"] as const) {
  process.on(event, () => {
    child.kill(event);
  });
}
