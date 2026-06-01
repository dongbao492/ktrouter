import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, REFRESH_LEAD_MS, buildKimiHeaders } from "../config/appConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// xAI refresh wraps the app OAuth service so this module stays provider-flat.
let _xaiServiceSingleton = null;
async function refreshXaiToken(refreshToken, log) {
  if (!refreshToken) return null;
  try {
    if (!_xaiServiceSingleton) {
      const mod = await import("../../src/lib/oauth/services/xai.js");
      _xaiServiceSingleton = new mod.XaiService();
    }
    const tokens = await _xaiServiceSingleton.refreshAccessToken(refreshToken);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
      idToken: tokens.id_token,
    };
  } catch (e) {
    log?.warn?.("TOKEN_REFRESH", `xai refresh failed: ${e?.message || e}`);
    const msg = String(e?.message || "");
    if (msg.includes("invalid_grant") || msg.includes("invalid_request")) {
      return { error: "invalid_grant" };
    }
    return null;
  }
}

// Default token expiry buffer (refresh if expires within 5 minutes)
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// In-flight refresh dedup: prevents race condition that triggers refresh_token_reused → Auth0 family revoke
const refreshPromiseCache = new Map();
function getRefreshCacheKey(provider, refreshToken) {
  return `${provider}:${refreshToken}`;
}

function getRefreshCacheIdentity(credentials) {
  return credentials?.refreshToken || credentials?.accessToken || credentials?.apiKey || null;
}

async function runRefreshWithDedupe(provider, credentials, log, refreshOperation) {
  const identity = getRefreshCacheIdentity(credentials);
  if (!identity) return refreshOperation();

  const cacheKey = getRefreshCacheKey(provider, identity);

  if (refreshPromiseCache.has(cacheKey)) {
    log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
    return refreshPromiseCache.get(cacheKey);
  }

  const refreshPromise = Promise.resolve().then(refreshOperation).finally(() => {
    refreshPromiseCache.delete(cacheKey);
  });

  refreshPromiseCache.set(cacheKey, refreshPromise);
  return refreshPromise;
}

function secondsUntil(expiresAt) {
  if (!expiresAt) return undefined;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return undefined;
  return Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
}

// Check if refresh result indicates unrecoverable error (caller should stop retry, force re-auth)
export function isUnrecoverableRefreshError(result) {
  return (
    result &&
    typeof result === "object" &&
    (result.error === "unrecoverable_refresh_error" ||
      result.error === "refresh_token_reused" ||
      result.error === "invalid_request" ||
      result.error === "invalid_grant")
  );
}

// Get provider-specific refresh lead time, falls back to default buffer
export function getRefreshLeadMs(provider) {
  return REFRESH_LEAD_MS[provider] || TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Refresh OAuth access token using refresh token
 */
export async function refreshAccessToken(provider, refreshToken, credentials, log) {
  const config = PROVIDERS[provider];

  if (!config || !config.refreshUrl) {
    log?.warn?.("TOKEN_REFRESH", `No refresh URL configured for provider: ${provider}`);
    return null;
  }

  if (!refreshToken) {
    log?.warn?.("TOKEN_REFRESH", `No refresh token available for provider: ${provider}`);
    return null;
  }

  try {
    const response = await fetch(config.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", `Failed to refresh token for ${provider}`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", `Successfully refreshed token for ${provider}`, {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Error refreshing token for ${provider}`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Specialized refresh for Claude OAuth tokens
 */
export async function refreshClaudeOAuthToken(refreshToken, log) {
  try {
    const response = await fetch(OAUTH_ENDPOINTS.anthropic.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PROVIDERS.claude.clientId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Claude OAuth token", { status: response.status, error: errorText });
      return null;
    }

    const tokens = await response.json();
    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Claude OAuth token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Claude token: ${error.message}`);
    return null;
  }
}

/**
 * Specialized refresh for Google providers (Gemini, Antigravity)
 */
export async function refreshGoogleToken(refreshToken, clientId, clientSecret, log) {
  try {
    const response = await fetch(OAUTH_ENDPOINTS.google.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Google token", { status: response.status, error: errorText });
      return null;
    }

    const tokens = await response.json();
    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Google token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Google token: ${error.message}`);
    return null;
  }
}

/**
 * Specialized refresh for Qwen OAuth tokens
 */
export async function refreshQwenToken(refreshToken, log) {
  const endpoint = OAUTH_ENDPOINTS.qwen.token;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PROVIDERS.qwen.clientId,
      }),
    });

    if (response.status === 200) {
      const tokens = await response.json();

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Qwen token", {
        hasNewAccessToken: !!tokens.access_token,
        hasNewRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
        providerSpecificData: tokens.resource_url
          ? { resourceUrl: tokens.resource_url }
          : undefined,
      };
    } else {
      const errorText = await response.text().catch(() => "");
      log?.warn?.("TOKEN_REFRESH", `Error with Qwen endpoint`, {
        status: response.status,
        error: errorText,
      });
    }
  } catch (error) {
    log?.warn?.("TOKEN_REFRESH", `Network error trying Qwen endpoint`, {
      error: error.message,
    });
  }

  log?.error?.("TOKEN_REFRESH", "Failed to refresh Qwen token");
  return null;
}

/**
 * Specialized refresh for Codex (OpenAI) OAuth tokens.
 * OpenAI uses rotating (one-time-use) refresh tokens.
 * Returns { error: 'unrecoverable_refresh_error' } when token already consumed/invalid,
 * so callers stop retrying and request re-authentication.
 */
export async function refreshCodexToken(refreshToken, log) {
  try {
  const response = await fetch(OAUTH_ENDPOINTS.openai.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: PROVIDERS.codex.clientId,
      scope: "openid profile email offline_access",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // Detect unrecoverable errors (token reused/expired) — Auth0 revokes whole family on retry
    let errorCode = null;
    try {
      const parsed = JSON.parse(errorText);
      errorCode = parsed?.error?.code || (typeof parsed?.error === "string" ? parsed.error : null);
    } catch {}

    if (
      errorCode === "refresh_token_reused" ||
      errorCode === "invalid_grant" ||
      errorCode === "token_expired" ||
      errorCode === "invalid_token"
    ) {
      log?.error?.("TOKEN_REFRESH", "Codex refresh token already used or invalid. Re-auth required.", {
        status: response.status,
        errorCode,
      });
      return { error: "unrecoverable_refresh_error", code: errorCode };
    }

    log?.error?.("TOKEN_REFRESH", "Failed to refresh Codex token", {
      status: response.status,
      error: errorText,
    });
    return null;
  }

  const tokens = await response.json();

  log?.info?.("TOKEN_REFRESH", "Successfully refreshed Codex token", {
    hasNewAccessToken: !!tokens.access_token,
    hasNewRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresIn: tokens.expires_in,
  };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Codex token: ${error.message}`);
    return null;
  }
}

/**
 * Specialized refresh for Kiro (AWS CodeWhisperer) tokens
 * Supports both AWS SSO OIDC (Builder ID/IDC) and Social Auth (Google/GitHub)
 */
export async function refreshKiroToken(refreshToken, providerSpecificData, log, proxyOptions = null) {
  const authMethod = providerSpecificData?.authMethod;
  const clientId = providerSpecificData?.clientId;
  const clientSecret = providerSpecificData?.clientSecret;
  const region = providerSpecificData?.region;

  // AWS SSO OIDC (Builder ID or IDC)
  // If clientId and clientSecret exist, assume AWS SSO OIDC (default to builder-id if authMethod not specified)
  if (clientId && clientSecret) {
    const isIDC = authMethod === "idc";
    const endpoint = isIDC && region
      ? `https://oidc.${region}.amazonaws.com/token`
      : "https://oidc.us-east-1.amazonaws.com/token";

    const response = await proxyAwareFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        clientId: clientId,
        clientSecret: clientSecret,
        refreshToken: refreshToken,
        grantType: "refresh_token",
      }),
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro AWS token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro AWS token", {
      hasNewAccessToken: !!tokens.accessToken,
      expiresIn: tokens.expiresIn,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  // Social Auth (Google/GitHub) - use Kiro's refresh endpoint
  const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "kiro-cli/1.0.0",
    },
    body: JSON.stringify({
      refreshToken: refreshToken,
    }),
  }, proxyOptions);

  if (!response.ok) {
    const errorText = await response.text();
    log?.error?.("TOKEN_REFRESH", "Failed to refresh Kiro social token", {
      status: response.status,
      error: errorText,
    });
    return null;
  }

  const tokens = await response.json();

  log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kiro social token", {
    hasNewAccessToken: !!tokens.accessToken,
    expiresIn: tokens.expiresIn,
  });

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || refreshToken,
    expiresIn: tokens.expiresIn,
  };
}

/**
 * Specialized refresh for iFlow OAuth tokens
 */
export async function refreshIflowToken(refreshToken, log) {
  const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);

  const response = await fetch(OAUTH_ENDPOINTS.iflow.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: PROVIDERS.iflow.clientId,
      client_secret: PROVIDERS.iflow.clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log?.error?.("TOKEN_REFRESH", "Failed to refresh iFlow token", {
      status: response.status,
      error: errorText,
    });
    return null;
  }

  const tokens = await response.json();

  log?.info?.("TOKEN_REFRESH", "Successfully refreshed iFlow token", {
    hasNewAccessToken: !!tokens.access_token,
    hasNewRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresIn: tokens.expires_in,
  };
}

/**
 * Specialized refresh for GitHub Copilot OAuth tokens
 */
export async function refreshGitHubToken(refreshToken, log) {
  const params = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: PROVIDERS.github.clientId,
  };
  if (PROVIDERS.github.clientSecret) {
    params.client_secret = PROVIDERS.github.clientSecret;
  }

  const response = await fetch(OAUTH_ENDPOINTS.github.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log?.error?.("TOKEN_REFRESH", "Failed to refresh GitHub token", {
      status: response.status,
      error: errorText,
    });
    return null;
  }

  const tokens = await response.json();

  log?.info?.("TOKEN_REFRESH", "Successfully refreshed GitHub token", {
    hasNewAccessToken: !!tokens.access_token,
    hasNewRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresIn: tokens.expires_in,
  };
}

/**
 * Refresh GitHub Copilot token using GitHub access token
 */
export async function refreshCopilotToken(githubAccessToken, log) {
  try {
    const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: {
        "Authorization": `token ${githubAccessToken}`,
        "User-Agent": GITHUB_COPILOT.USER_AGENT,
        "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
        "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
        "Accept": "application/json",
        "x-github-api-version": GITHUB_COPILOT.API_VERSION
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Copilot token", {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const data = await response.json();

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Copilot token", {
      hasToken: !!data.token,
      expiresAt: data.expires_at
    });

    return {
      token: data.token,
      expiresAt: data.expires_at
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", "Error refreshing Copilot token", {
      error: error.message
    });
    return null;
  }
}

export async function refreshGitHubAndCopilotTokens(credentials, log) {
  if (!credentials?.refreshToken) return null;

  const githubTokens = await refreshGitHubToken(credentials.refreshToken, log);
  if (!githubTokens?.accessToken) return githubTokens;

  const copilotToken = await refreshCopilotToken(githubTokens.accessToken, log);
  if (!copilotToken?.token) return githubTokens;

  return {
    ...githubTokens,
    copilotToken: copilotToken.token,
    copilotTokenExpiresAt: copilotToken.expiresAt,
    providerSpecificData: {
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}

export async function refreshClineToken(refreshToken, log) {
  if (!refreshToken) return null;

  try {
    const response = await fetch(PROVIDERS.cline.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        refreshToken,
        grantType: "refresh_token",
        clientType: "extension",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Cline token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const payload = await response.json();
    const data = payload?.data || payload;
    const expiresIn =
      data?.expiresIn ||
      data?.expires_in ||
      secondsUntil(data?.expiresAt || data?.expires_at) ||
      3600;

    if (!data?.accessToken && !data?.access_token) return null;

    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Cline token", {
      hasNewAccessToken: true,
      hasNewRefreshToken: !!(data?.refreshToken || data?.refresh_token),
      expiresIn,
    });

    return {
      accessToken: data.accessToken || data.access_token,
      refreshToken: data.refreshToken || data.refresh_token || refreshToken,
      expiresIn,
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Cline token: ${error.message}`);
    return null;
  }
}

export async function refreshKimiCodingToken(refreshToken, log) {
  if (!refreshToken) return null;

  try {
    const response = await fetch(PROVIDERS["kimi-coding"].refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...buildKimiHeaders(),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PROVIDERS["kimi-coding"].clientId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Kimi Coding token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();
    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Kimi Coding token", {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Kimi Coding token: ${error.message}`);
    return null;
  }
}

export async function refreshCodeBuddyToken(refreshToken, log) {
  if (!refreshToken) return null;

  try {
    const response = await fetch(PROVIDERS.codebuddy.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": PROVIDERS.codebuddy.userAgent,
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "copilot.tencent.com",
        "X-No-Authorization": "true",
        "X-No-User-Id": "true",
        "X-Product": "SaaS",
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh CodeBuddy token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const payload = await response.json();
    if (payload?.code !== undefined && payload.code !== 0) {
      log?.error?.("TOKEN_REFRESH", "CodeBuddy token refresh returned an error", {
        code: payload.code,
        message: payload.msg,
      });
      return null;
    }

    const data = payload?.data || payload;
    const accessToken = data?.accessToken || data?.access_token;
    if (!accessToken) return null;

    return {
      accessToken,
      refreshToken: data?.refreshToken || data?.refresh_token || refreshToken,
      expiresIn: data?.expiresIn || data?.expires_in || 86400,
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing CodeBuddy token: ${error.message}`);
    return null;
  }
}

export async function refreshGitLabToken(refreshToken, credentials = {}, log) {
  if (!refreshToken) return null;

  const providerSpecificData = credentials.providerSpecificData || {};
  const baseUrl = (providerSpecificData.baseUrl || credentials.baseUrl || "https://gitlab.com").replace(/\/$/, "");
  const clientId = providerSpecificData.clientId || credentials.clientId;
  const clientSecret = providerSpecificData.clientSecret || credentials.clientSecret;

  if (!clientId) {
    log?.warn?.("TOKEN_REFRESH", "Cannot refresh GitLab token without clientId");
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    if (clientSecret) body.set("client_secret", clientSecret);

    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh GitLab token", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
      providerSpecificData: { baseUrl, clientId },
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing GitLab token: ${error.message}`);
    return null;
  }
}

/**
 * Get access token for a specific provider (with in-flight dedup).
 * If a refresh is already in-flight for same provider+token, share the promise
 * to prevent parallel OAuth requests → Auth0 'refresh_token_reused' family revoke.
 */
export async function getAccessToken(provider, credentials, log) {
  if (!credentials || !credentials.refreshToken || typeof credentials.refreshToken !== "string") {
    log?.warn?.("TOKEN_REFRESH", `No valid refresh token available for provider: ${provider}`);
    return null;
  }

  return runRefreshWithDedupe(provider, credentials, log, () =>
    _getAccessTokenInternal(provider, credentials, log)
  );
}

async function _getAccessTokenInternal(provider, credentials, log) {
  switch (provider) {
    case "gemini":
    case "gemini-cli":
    case "antigravity":
      return await refreshGoogleToken(
        credentials.refreshToken,
        PROVIDERS[provider].clientId,
        PROVIDERS[provider].clientSecret,
        log
      );

    case "claude":
      return await refreshClaudeOAuthToken(credentials.refreshToken, log);

    case "codex":
      return await refreshCodexToken(credentials.refreshToken, log);

    case "qwen":
      return await refreshQwenToken(credentials.refreshToken, log);

    case "iflow":
      return await refreshIflowToken(credentials.refreshToken, log);

    case "github":
      return await refreshGitHubAndCopilotTokens(credentials, log);

    case "kiro":
      return await refreshKiroToken(
        credentials.refreshToken,
        credentials.providerSpecificData,
        log
      );

    case "xai":
      return await refreshXaiToken(credentials.refreshToken, log);

    case "cline":
      return await refreshClineToken(credentials.refreshToken, log);

    case "kimi-coding":
      return await refreshKimiCodingToken(credentials.refreshToken, log);

    case "codebuddy":
      return await refreshCodeBuddyToken(credentials.refreshToken, log);

    case "gitlab":
      return await refreshGitLabToken(credentials.refreshToken, credentials, log);

    case "vertex":
    case "vertex-partner": {
      const saJson = parseVertexSaJson(credentials.apiKey);
      if (!saJson) return null;
      return await refreshVertexToken(saJson, log);
    }

    default:
      return await refreshAccessToken(provider, credentials.refreshToken, credentials, log);
  }
}

/**
 * Unified credential refresh path.
 * Dedupe wraps the whole operation, so concurrent callers share one refresh and
 * rotating refresh tokens are persisted before another caller can consume them.
 */
export async function refreshProviderCredentials(provider, credentials, log, options = {}) {
  if (!credentials) return null;

  const refreshFn = typeof options.refreshFn === "function"
    ? options.refreshFn
    : () => _getAccessTokenInternal(provider, credentials, log);
  const maxRetries = Number.isInteger(options.maxRetries) ? Math.max(1, options.maxRetries) : 1;

  return runRefreshWithDedupe(provider, credentials, log, () =>
    refreshWithRetry(refreshFn, maxRetries, log)
  );
}

/**
 * Refresh token by provider type (helper for handlers)
 */
export async function refreshTokenByProvider(provider, credentials, log) {
  return refreshProviderCredentials(provider, credentials, log);
}

/**
 * Format credentials for provider
 */
export function formatProviderCredentials(provider, credentials, log) {
  const config = PROVIDERS[provider];
  if (!config) {
    log?.warn?.("TOKEN_REFRESH", `No configuration found for provider: ${provider}`);
    return null;
  }

  switch (provider) {
    case "gemini":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        projectId: credentials.projectId
      };

    case "claude":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "codex":
    case "qwen":
    case "iflow":
    case "openai":
    case "openrouter":
    case "xai":
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken
      };

    case "antigravity":
    case "gemini-cli":
      return {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        projectId: credentials.projectId
      };

    default:
      return {
        apiKey: credentials.apiKey,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken
      };
  }
}

/**
 * Get all access tokens for a user
 */
export async function getAllAccessTokens(userInfo, log) {
  const results = {};

  if (userInfo.connections && Array.isArray(userInfo.connections)) {
    for (const connection of userInfo.connections) {
      if (connection.isActive && connection.provider) {
        const token = await getAccessToken(connection.provider, {
          refreshToken: connection.refreshToken
        }, log);

        if (token) {
          results[connection.provider] = token;
        }
      }
    }
  }

  return results;
}

/**
 * Parse Vertex AI Service Account JSON from apiKey string
 */
export function parseVertexSaJson(apiKey) {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// Cache Vertex tokens keyed by service account email { token, expiresAt }
const vertexTokenCache = new Map();

/**
 * Mint a short-lived OAuth2 Bearer token for Google Cloud Vertex AI
 * using Service Account JSON + jose (RS256 JWT assertion flow).
 * Token is cached until 5 minutes before expiry.
 */
export async function refreshVertexToken(saJson, log) {
  const cacheKey = saJson.client_email;
  const cached = vertexTokenCache.get(cacheKey);

  // Return cached token if still valid (5-min buffer)
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { accessToken: cached.token, expiresAt: cached.expiresAt };
  }

  try {
    const { SignJWT, importPKCS8 } = await import("jose");
    log?.debug?.("TOKEN_REFRESH", `Vertex minting token for ${saJson.client_email}`);
    const privateKey = await importPKCS8(saJson.private_key.replace(/\\n/g, "\n"), "RS256");
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(saJson.client_email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log?.error?.("TOKEN_REFRESH", `Vertex token mint failed: ${err}`);
      return null;
    }

    const { access_token, expires_in } = await res.json();
    const expiresAt = Date.now() + (expires_in ?? 3600) * 1000;

    vertexTokenCache.set(cacheKey, { token: access_token, expiresAt });
    log?.info?.("TOKEN_REFRESH", `Vertex token minted for ${saJson.client_email}`);

    return { accessToken: access_token, expiresAt };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Vertex token error: ${error.message}`);
    return null;
  }
}

/**
 * Refresh token with retry and exponential backoff
 * Retries on failure with increasing delay: 1s, 2s, 3s...
 * @param {function} refreshFn - Async function that returns token or null
 * @param {number} maxRetries - Max retry attempts (default 3)
 * @param {object} log - Logger instance (optional)
 * @returns {Promise<object|null>} Token result or null if all retries fail
 */
export async function refreshWithRetry(refreshFn, maxRetries = 3, log = null) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 1000;
      log?.debug?.("TOKEN_REFRESH", `Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const result = await refreshFn();
      if (isUnrecoverableRefreshError(result)) {
        log?.error?.("TOKEN_REFRESH", "Refresh token is invalid or already consumed; re-authentication required");
        return result;
      }
      if (result) return result;
    } catch (error) {
      log?.warn?.("TOKEN_REFRESH", `Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
    }
  }

  log?.error?.("TOKEN_REFRESH", `All ${maxRetries} retry attempts failed`);
  return null;
}
