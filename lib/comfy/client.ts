import { Client } from "@stable-canvas/comfyui-client";
import { ServerError, ServerErrorTypes } from "../errors/server-error";

type _ExtendedClient = Client & {
  isConnected: boolean;
};

const client = new Client({
  api_host: process.env.COMFY_BASE_URL!,
  ssl: false,
}) as _ExtendedClient;

client.isConnected = false;

async function tryToConnect() {
  console.log(
    `Trying to connect to ComfyUI [${process.env.COMFY_BASE_URL}]...`,
  );
  console.log("Checking system stats to verify connection...");
  try {
    const stats = await client.getSystemStats();
    console.log("System stats:", stats);

    client.isConnected = !!(await client.connect({
      websocket: {
        enabled: true,
      },
    }));
    console.log("Connected to ComfyUI:", client.isConnected);
  } catch (error) {
    console.error("Failed to connect to ComfyUI:", error);
    throw new ServerError(
      "Failed to connect to ComfyUI",
      ServerErrorTypes.ComfyNotAccessible,
    );
  }
}

export const getClient = async () => {
  if (!client.isConnected) {
    await tryToConnect();
  }
  return client;
};
