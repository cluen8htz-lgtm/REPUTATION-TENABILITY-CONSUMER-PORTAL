import { createKimiGateway } from "./ai-client";

let cached: ReturnType<typeof createKimiGateway> | undefined;

export function kimiGw(modelId: string) {
  cached ??= createKimiGateway();
  return cached(modelId);
}
