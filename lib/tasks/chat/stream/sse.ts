export type ChatStreamEvent<TChatResponse> =
  | {
      type: "reasoning.delta";
      content: string;
    }
  | {
      type: "message.delta";
      content: string;
    }
  | {
      type: "error";
      error?: {
        message?: string;
      };
    }
  | {
      type: "chat.end";
      result: TChatResponse;
    };

export const parseSseEvents = async <TChatResponse>({
  stream,
  onEvent,
  onRawEvent,
}: {
  stream: ReadableStream<Uint8Array>;
  onEvent: (event: ChatStreamEvent<TChatResponse>) => void;
  onRawEvent?: (eventType: string, data: Record<string, unknown>) => void;
}) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processEventBlock = (rawEventBlock: string) => {
    const lines = rawEventBlock.split(/\r?\n/);
    let eventType = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        const dataValue = line.slice("data:".length);
        dataLines.push(
          dataValue.startsWith(" ") ? dataValue.slice(1) : dataValue,
        );
      }
    }

    if (!eventType || dataLines.length === 0) {
      return;
    }

    const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    onRawEvent?.(eventType, data);
    onEvent({
      type: eventType,
      ...(data as object),
    } as ChatStreamEvent<TChatResponse>);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const separatorMatch = /\r?\n\r?\n/.exec(buffer);
      if (!separatorMatch || separatorMatch.index === undefined) {
        break;
      }

      const separatorIndex = separatorMatch.index;
      const separatorLength = separatorMatch[0].length;

      const rawEventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + separatorLength);
      processEventBlock(rawEventBlock);
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    processEventBlock(trailing);
  }
};
