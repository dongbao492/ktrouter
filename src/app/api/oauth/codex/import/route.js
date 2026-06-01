import { NextResponse } from "next/server";
import { createProviderConnection, getProviderConnections } from "@/models";
import { parseCodexImportJson } from "@/lib/oauth/codexImport";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/codex/import
 * Accepts pasted JSON from:
 * - 9router export format: { connections: [...] }
 * - ChatGPT session JSON from https://chatgpt.com/api/auth/session
 * - Cockpit-ish Codex token JSON with access_token/id_token
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const jsonText = typeof body?.json === "string"
      ? body.json
      : JSON.stringify(body);
    const connections = parseCodexImportJson(jsonText);
    const existing = await getProviderConnections({ provider: "codex" });
    const existingEmails = new Set(
      existing
        .map((conn) => String(conn.email || "").trim().toLowerCase())
        .filter(Boolean)
    );

    let imported = 0;
    let skipped = 0;
    const results = [];

    for (const conn of connections) {
      try {
        const emailKey = String(conn.email || "").trim().toLowerCase();
        if (emailKey && existingEmails.has(emailKey)) {
          skipped++;
          results.push({
            status: "skipped",
            email: conn.email,
            name: conn.name,
            reason: "duplicate_email",
          });
          continue;
        }

        const saved = await createProviderConnection({
          ...conn,
          provider: "codex",
          authType: "oauth",
          testStatus: conn.testStatus || "active",
        });
        imported++;
        if (emailKey) existingEmails.add(emailKey);
        results.push({
          status: "imported",
          id: saved.id,
          email: saved.email,
          name: saved.name,
        });
      } catch (error) {
        skipped++;
        results.push({
          status: "error",
          email: conn.email,
          name: conn.name,
          reason: error.message,
        });
      }
    }

    return NextResponse.json({
      success: imported > 0,
      imported,
      skipped,
      total: connections.length,
      results,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 400 });
  }
}
