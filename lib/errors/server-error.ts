export enum ServerErrorTypes {
  ComfyNotAccessible = "ComfyNotAccessible",
}

export class ServerError extends Error {
  type?: ServerErrorTypes;
  constructor(message: string, type?: ServerErrorTypes) {
    super(message);
    this.type = type;
    this.name = "ServerError";
  }
}

export function toHttpError(error: unknown): { status: number; body: string } {
  if (error instanceof ServerError) {
    switch (error.type) {
      case ServerErrorTypes.ComfyNotAccessible:
        return {
          status: 503,
          body: JSON.stringify({ error: "ComfyUI is not accessible" }),
        };
      default:
        return {
          status: 500,
          body: JSON.stringify({ error: "Internal Server Error" }),
        };
    }
  }
  return {
    status: 500,
    body: JSON.stringify({ error: "Internal Server Error" }),
  };
}
