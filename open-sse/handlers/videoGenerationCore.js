import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshProviderCredentials, isUnrecoverableRefreshError } from "../services/tokenRefresh.js";
import { getExecutor } from "../executors/index.js";
import { getVideoAdapter } from "./videoProviders/index.js";

function serializeRequestBody(requestBody) {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

/**
 * Core video generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./videoProviders/{id}.js`.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, aspect_ratio, duration, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {boolean} [options.streamToClient] - Pipe SSE to client (if needed)
 * @param {boolean} [options.binaryOutput] - Return raw bytes (unsupported for video but kept for interface match)
 * @param {function} [options.onCredentialsRefreshed]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleVideoGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  streamToClient = false,
  binaryOutput = false,
  onCredentialsRefreshed,
  onRequestSuccess,
}) {
  const { provider, model } = modelInfo;

  if (!body.prompt && !body.image) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt or image");
  }

  const adapter = getVideoAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support video generation`
    );
  }

  let url;
  let headers;
  let requestBody;

  try {
    url = adapter.buildUrl(model, credentials);
    requestBody = await adapter.buildBody(model, body);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message || `Invalid ${provider} video request`);
  }

  log?.debug?.("VIDEO", `${provider.toUpperCase()} | ${model} | prompt="${(body.prompt || "").slice(0, 50)}..."`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("VIDEO", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh (skipped for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    !adapter.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshProviderCredentials(provider, credentials, log, {
      refreshFn: () => executor.refreshCredentials(credentials, log),
    });

    if (isUnrecoverableRefreshError(newCredentials)) {
      return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `${provider} refresh token is invalid or expired. Please re-authorize this provider.`);
    }

    if (newCredentials?.accessToken || newCredentials?.apiKey || newCredentials?.copilotToken) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for video generation`);
      const providerSpecificData = newCredentials.providerSpecificData
        ? { ...(credentials.providerSpecificData || {}), ...newCredentials.providerSpecificData }
        : credentials.providerSpecificData;
      Object.assign(credentials, newCredentials);
      if (providerSpecificData) credentials.providerSpecificData = providerSpecificData;
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryBody = await adapter.buildBody(model, body);
        const retryHeaders = adapter.buildHeaders(credentials, retryBody, model, body);
        const retryUrl = adapter.buildUrl(model, credentials);
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: serializeRequestBody(retryBody),
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("VIDEO", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  // Parse provider response — adapter may override (async polling / custom responses)
  let parsed;
  try {
    if (adapter.parseResponse) {
      parsed = await adapter.parseResponse(providerResponse, {
        headers,
        log,
        streamToClient,
        onRequestSuccess,
        url,
        requestBody,
        model,
        body,
      });
    } else {
      parsed = await providerResponse.json();
    }
  } catch (parseError) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, parseError.message || `Invalid response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  // Normalize → OpenAI-compatible shape
  const normalized = adapter.normalize(parsed, body.prompt);

  // Already in OpenAI shape? skip re-normalize
  const finalBody = (normalized.created && Array.isArray(normalized.data)) ? normalized : parsed;

  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
