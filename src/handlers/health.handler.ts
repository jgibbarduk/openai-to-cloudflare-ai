/**
 * ============================================================================
 * HEALTH HANDLER
 * ============================================================================
 *
 * Handles /health endpoint for monitoring
 */

export async function handleHealth(env: Env): Promise<Response> {
  const health: { status: string; timestamp: string; providers: { workers_ai: string } } = {
    status: "ok",
    timestamp: new Date().toISOString(),
    providers: {
      workers_ai: "up"
    }
  };

  // Optionally check if AI binding is available
  try {
    if (env.AI) {
      health.providers.workers_ai = "up";
    }
  } catch {
    health.providers.workers_ai = "down";
    health.status = "degraded";
  }

  return new Response(JSON.stringify(health), {
    status: health.status === "ok" ? 200 : 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

