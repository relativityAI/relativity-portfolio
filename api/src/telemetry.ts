/**
 * Langfuse + OpenTelemetry telemetry registration.
 * Import this module once at server startup (before any AI SDK calls).
 *
 * Env vars consumed by Langfuse:
 *   LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL (optional, defaults to cloud).
 * When none are set, telemetry is a no-op — safe in dev.
 */

import { log } from "./logger.js";

let initialized = false;

export async function initTelemetry(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;

  if (!secretKey || !publicKey) {
    log.info("[telemetry]", "Langfuse keys not set — telemetry disabled");
    return;
  }

  try {
    const { registerTelemetry } = await import("ai");
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");
    const { LangfuseVercelAiSdkIntegration } = await import("@langfuse/vercel-ai-sdk");
    const { NodeSDK } = await import("@opentelemetry/sdk-node");

    const sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    sdk.start();

    registerTelemetry(new LangfuseVercelAiSdkIntegration());

    log.info("[telemetry]", "Langfuse + OTel registered");
  } catch (e: any) {
    log.error("[telemetry]", `Failed to initialize: ${e.message}`);
  }
}
