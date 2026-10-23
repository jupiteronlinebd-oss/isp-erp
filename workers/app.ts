import { createRequestHandler } from "react-router";
import * as build from "../build/server/virtual/server-build.js";
import { runAutoCleanup } from "../app/lib/cleanup";
import { runAutoSuspend } from "../app/lib/auto-suspend";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createRequestHandler(build, "production")(request, env);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const [cleanupResult, suspendResult] = await Promise.all([runAutoCleanup(env.DB), runAutoSuspend(env.DB)]);
  },
} satisfies ExportedHandler<Env>;
