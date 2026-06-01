import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections } from "@/models";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/import
 * Import provider connections from exported JSON.
 * Body: { connections: [...] } (same format as export)
 * Skips duplicates by provider+email or provider+apiKey.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const incoming = body?.connections;

    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ error: "No connections to import" }, { status: 400 });
    }

    const existing = await getProviderConnections();
    const existingKeys = new Set(
      existing.map(c => `${c.provider}:${c.email || c.apiKey || c.refreshToken || ""}`)
    );

    let imported = 0;
    let skipped = 0;
    const results = [];

    for (const conn of incoming) {
      if (!conn.provider) {
        results.push({ provider: "unknown", status: "skipped", reason: "no provider" });
        skipped++;
        continue;
      }

      const key = `${conn.provider}:${conn.email || conn.apiKey || conn.refreshToken || ""}`;
      if (existingKeys.has(key)) {
        results.push({ provider: conn.provider, email: conn.email, status: "skipped", reason: "duplicate" });
        skipped++;
        continue;
      }

      try {
        await createProviderConnection({
          provider: conn.provider,
          authType: conn.authType || "oauth",
          accessToken: conn.accessToken || null,
          refreshToken: conn.refreshToken || null,
          idToken: conn.idToken || null,
          apiKey: conn.apiKey || null,
          expiresAt: conn.expiresAt || null,
          email: conn.email || null,
          name: conn.name || null,
          providerSpecificData: conn.providerSpecificData || {},
          testStatus: "unknown",
        });
        existingKeys.add(key);
        results.push({ provider: conn.provider, email: conn.email, status: "imported" });
        imported++;
      } catch (e) {
        results.push({ provider: conn.provider, email: conn.email, status: "error", reason: e.message });
        skipped++;
      }
    }

    return NextResponse.json({ imported, skipped, total: incoming.length, results });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}