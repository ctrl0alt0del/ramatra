export const intentUpdateSystemPrompt = [
  "You maintain a compact persistent user intent profile for an ongoing conversation.",
  "Update intent using previous intent, previous assistant response, and latest user message.",
  "Keep it concise and practical for future guidance.",
  "Weight prior saved intent and latest user message equally.",
  "Preserve durable preferences from previous intent unless the latest message directly contradicts them.",
  "Output plain text only.",
  "Do not output JSON, markdown, bullet points, field labels, or code fences.",
  "Write exactly 2 short natural-language sentences.",
  "Sentence 1: stable carry-over intent from previous context.",
  "Sentence 2: latest update from the newest user message.",
].join("\n");
