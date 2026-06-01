import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";

export const dynamic = "force-dynamic";

/**
 * GET /api/providers/export
 * Export all provider connections (including secrets) as JSON.
 * Use ?provider=kiro to filter by single provider.
 *
 * Response is downloadable as ktrouter-credentials-{timestamp}.json
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const filterProvider = url.searchParams.get("provider");
    const filterConnectionId = url.searchParams.get("connectionId");
    const includeSecrets = url.searchParams.get("secrets") !== "false";

    const connections = await getProviderConnections();
    let filtered = connections;
    if (filterConnectionId) {
      filtered = connections.filter(c => c.id === filterConnectionId);
    } else if (filterProvider) {
      filtered = connections.filter(c => c.provider === filterProvider);
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      connections: filtered.map(c => ({
        id: c.id,
        provider: c.provider,
        authType: c.authType,
        name: c.name,
        email: c.email,
        isActive: c.isActive,
        expiresAt: c.expiresAt,
        providerSpecificData: c.providerSpecificData,
        ...(includeSecrets && {
          apiKey: c.apiKey,
          accessToken: c.accessToken,
          refreshToken: c.refreshToken,
          idToken: c.idToken,
        }),
      })),
    };

    const firstConn = filtered[0];
    const namePart = filterConnectionId && firstConn
      ? (firstConn.email || firstConn.name || firstConn.provider || "account").replace(/[^a-zA-Z0-9@._-]/g, "_")
      : filterProvider || "all";
    const filename = `ktrouter-${namePart}-${Date.now()}.json`;
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}