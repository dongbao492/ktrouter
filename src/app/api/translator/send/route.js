import { getProviderConnections } from "@/lib/localDb.js";
import { getExecutor } from "open-sse/index.js";
import {
  checkAndRefreshToken,
  refreshProviderCredentials,
  updateProviderCredentials,
  isUnrecoverableRefreshError,
} from "@/sse/services/tokenRefresh.js";

function mergeCredentials(target, patch) {
  const providerSpecificData = patch.providerSpecificData
    ? { ...(target.providerSpecificData || {}), ...patch.providerSpecificData }
    : target.providerSpecificData;
  Object.assign(target, patch);
  if (providerSpecificData) target.providerSpecificData = providerSpecificData;
  return target;
}

export async function POST(request) {
  try {
    const { provider, model, body } = await request.json();

    if (!provider || !model || !body) {
      return Response.json({ success: false, error: "provider, model, and body required" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const connection = connections.find(c => c.isActive !== false);
    if (!connection) {
      return Response.json({ success: false, error: `No active connection for provider: ${provider}` }, { status: 400 });
    }

    const credentials = {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      copilotToken: connection.providerSpecificData?.copilotToken || connection.copilotToken,
      copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt || connection.copilotTokenExpiresAt,
      projectId: connection.projectId,
      providerSpecificData: connection.providerSpecificData,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      connectionId: connection.id,
    };

    const executor = getExecutor(provider);
    const stream = body.stream !== false;
    const activeCredentials = await checkAndRefreshToken(provider, credentials);

    let { response } = await executor.execute({ model, body, stream, credentials: activeCredentials });

    // Auto-refresh token on 401/403 and retry (same as chatCore.js)
    if (response.status === 401 || response.status === 403) {
      const newCredentials = await refreshProviderCredentials(provider, activeCredentials, {
        refreshFn: () => executor.refreshCredentials(activeCredentials, console),
      });
      if (isUnrecoverableRefreshError(newCredentials)) {
        return Response.json({
          success: false,
          error: `${provider} refresh token is invalid or expired. Please re-authorize this provider.`,
        }, { status: 401 });
      }
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        mergeCredentials(activeCredentials, newCredentials);
        await updateProviderCredentials(connection.id, {
          ...newCredentials,
          existingProviderSpecificData: activeCredentials.providerSpecificData,
          testStatus: "active",
        });
        ({ response } = await executor.execute({ model, body, stream, credentials: activeCredentials }));
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Translator] Provider error ${response.status}:`, errorText.slice(0, 500));
      return Response.json({ success: false, error: `Provider error: ${response.status}`, details: errorText }, { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  } catch (error) {
    console.error("[Translator] Send error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
