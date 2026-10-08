/**
 * AgentCraft Genesis G7-05 — Studio catalog endpoint.
 *
 * GET /api/studio/catalog
 *   Returns the documented capability catalog loaded from the controlled
 *   data/ directory. NO Install/Connect/Enable/Execute actions.
 *
 * Per req #7: controlled server-side path. The file paths are FIXED —
 * the endpoint does NOT accept user input for the path. No secrets,
 * no env vars, no arbitrary filesystem access.
 *
 * Per req #2: statuses are DOCUMENTED / INTEGRATED / RUNTIME_VERIFIED
 * based on evidence. RUNTIME_VERIFIED is NEVER returned (requires actual
 * runtime probing, out of scope).
 *
 * Per req #6: read-only. The endpoint only returns data; it does not
 * modify the catalog or create new entries.
 */

import { NextResponse } from "next/server";
import { loadCatalog } from "@/lib/studio/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { ownership, census, errors } = loadCatalog();
    return NextResponse.json(
      {
        ok: true,
        ownership,
        census,
        errors,
        // Honest notice: no /capabilities endpoint on the gateway.
        // All data comes from the controlled data/ YAML files.
        source: "controlled data/ directory (data/ownership.yaml + data/upstream-capabilities.yaml)",
        runtimeVerifiedCount: 0,
        integratedCount: [...ownership, ...census].filter(
          (c) => c.status === "INTEGRATED",
        ).length,
        documentedCount: [...ownership, ...census].filter(
          (c) => c.status === "DOCUMENTED",
        ).length,
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "CATALOG_LOAD_FAILED",
          message:
            e instanceof Error ? e.message : "could not load catalog",
        },
      },
      { status: 503 },
    );
  }
}
