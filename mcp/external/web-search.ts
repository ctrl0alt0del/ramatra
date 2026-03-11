import dotenv from "dotenv";
import { spawn } from "child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

const webSearchEnabled = process.env.WEB_SEARCH_MCP_ENABLED === "true";
const webSearchWorkdir = process.env.WEB_SEARCH_MCP_WORKDIR;
const webSearchCommand = process.env.WEB_SEARCH_MCP_START_CMD ?? "pnpm";
const webSearchArgs = process.env.WEB_SEARCH_MCP_START_ARGS?.split(" ").filter(
  Boolean,
) ?? ["start:http"];

if (!webSearchEnabled) {
  console.log("[mcp:web-search] disabled");
  process.exit(0);
}

if (!webSearchWorkdir) {
  console.error("[mcp:web-search] WEB_SEARCH_MCP_WORKDIR is not set");
  process.exit(1);
}

console.log(
  `[mcp:web-search] starting "${webSearchCommand} ${webSearchArgs.join(" ")}" in ${webSearchWorkdir}`,
);

const child = spawn(webSearchCommand, webSearchArgs, {
  cwd: webSearchWorkdir,
  stdio: "inherit",
  shell: true,
});

child.on("error", (error) => {
  console.error("[mcp:web-search] failed to start", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[mcp:web-search] exited due to signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});

for (const event of ["SIGINT", "SIGTERM"] as const) {
  process.on(event, () => {
    child.kill(event);
  });
}
