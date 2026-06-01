import { KIRO_CONFIG } from "../constants/oauth.js";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";

/**
 * Kiro OAuth Service
 * Supports multiple authentication methods:
 * 1. AWS Builder ID (Device Code Flow)
 * 2. AWS IAM Identity Center/IDC (Device Code Flow)
 * 3. Google/GitHub Social Login (Authorization Code Flow + Manual Callback)
 * 4. Import Token (Manual refresh token paste)
 */

const KIRO_AUTH_SERVICE = "https://prod.us-east-1.auth.desktop.kiro.dev";

export class KiroService {
  decodeJwtPayload(token) {
    try {
      if (!token || typeof token !== "string") return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      let payload = parts[1];
      while (payload.length % 4) {
        payload += "=";
      }

      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
  }

  pickEmailCandidate(...values) {
    for (const value of values) {
      const text = String(value || "").trim();
      if (text && text.includes("@")) return text;
    }
    return null;
  }

  async findCachedAccountByRefreshToken(refreshToken) {
    if (!refreshToken || typeof refreshToken !== "string") return null;

    try {
      const cachePath = join(homedir(), ".aws/sso/cache");
      const files = await readdir(cachePath);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await readFile(join(cachePath, file), "utf-8");
          const data = JSON.parse(content);
          if (data.refreshToken !== refreshToken) continue;

          return {
            email: this.pickEmailCandidate(
              data.email,
              data.loginHint,
              data.login_hint
            ),
            accessToken: data.accessToken || null,
            source: file,
          };
        } catch {
          continue;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  getLocalKiroGlobalStorageDir() {
    if (process.platform === "win32") {
      const appData = process.env.APPDATA;
      if (!appData) return null;
      return join(appData, "Kiro", "User", "globalStorage");
    }

    if (process.platform === "darwin") {
      return join(homedir(), "Library", "Application Support", "Kiro", "User", "globalStorage");
    }

    return join(homedir(), ".config", "Kiro", "User", "globalStorage");
  }

  async readLocalProfileSnapshot() {
    const dir = this.getLocalKiroGlobalStorageDir();
    if (!dir) return null;

    try {
      const raw = await readFile(join(dir, "kiro.kiroagent", "profile.json"), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  readLocalUsageSnapshot() {
    const dir = this.getLocalKiroGlobalStorageDir();
    if (!dir) return null;

    try {
      const db = new DatabaseSync(join(dir, "state.vscdb"));
      try {
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("kiro.kiroAgent");
        if (!row?.value) return null;
        return JSON.parse(row.value);
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  async readLocalKiroIdentity(profileArn) {
    const profile = await this.readLocalProfileSnapshot();
    const usage = this.readLocalUsageSnapshot();

    const localArn = String(profile?.arn || profile?.profileArn || "").trim();
    if (profileArn && localArn && localArn !== String(profileArn).trim()) {
      return null;
    }

    return {
      email: this.pickEmailCandidate(
        usage?.userInfo?.email,
        usage?.email,
        profile?.email,
        profile?.login_hint,
        profile?.loginHint
      ),
      userId: String(usage?.userInfo?.userId || profile?.userId || "").trim() || null,
      profileArn: localArn || null,
      loginProvider: String(profile?.loginProvider || profile?.name || "").trim() || null,
    };
  }

  async fetchRemoteKiroIdentity(accessToken, profileArn) {
    if (!accessToken) return null;

    const attempts = [
      {
        url: "https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?isEmailRequired=true&origin=AI_EDITOR&resourceType=AGENTIC_REQUEST",
        options: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "x-amz-user-agent": "aws-sdk-js/1.0.0 KiroIDE",
            "user-agent": "aws-sdk-js/1.0.0 KiroIDE",
          },
        },
      },
      {
        url: `https://q.us-east-1.amazonaws.com/getUsageLimits?isEmailRequired=true&origin=AI_EDITOR&profileArn=${encodeURIComponent(profileArn || "")}&resourceType=AGENTIC_REQUEST`,
        options: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        },
      },
    ];

    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: "GET",
          ...attempt.options,
        });
        if (!response.ok) continue;

        const data = await response.json().catch(() => null);
        if (!data || typeof data !== "object") continue;

        const email = this.pickEmailCandidate(
          data?.userInfo?.email,
          data?.email
        );
        const userId = String(data?.userInfo?.userId || data?.userId || "").trim() || null;

        if (email || userId) {
          return { email, userId, raw: data };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  async resolveEmail({ accessToken, refreshToken, tokenData = {}, profileArn = null } = {}) {
    const explicitEmail = this.pickEmailCandidate(
      tokenData.email,
      tokenData.loginHint,
      tokenData.login_hint
    );
    if (explicitEmail) return explicitEmail;

    const idTokenPayload = this.decodeJwtPayload(tokenData.idToken);
    const idTokenEmail = this.pickEmailCandidate(
      idTokenPayload?.email,
      idTokenPayload?.preferred_username
    );
    if (idTokenEmail) return idTokenEmail;

    const accessTokenEmail = this.extractEmailFromJWT(accessToken);
    if (accessTokenEmail) return accessTokenEmail;

    const remoteIdentity = await this.fetchRemoteKiroIdentity(accessToken, profileArn || tokenData.profileArn);
    if (remoteIdentity?.email) return remoteIdentity.email;

    const localIdentity = await this.readLocalKiroIdentity(profileArn || tokenData.profileArn);
    if (localIdentity?.email) return localIdentity.email;

    const cached = await this.findCachedAccountByRefreshToken(refreshToken);
    if (cached?.email) return cached.email;

    const cachedTokenEmail = this.extractEmailFromJWT(cached?.accessToken);
    if (cachedTokenEmail) return cachedTokenEmail;

    return null;
  }

  /**
   * Register OIDC client with AWS SSO
   * Returns clientId and clientSecret for device code flow
   */
  async registerClient(region = "us-east-1") {
    const endpoint = `https://oidc.${region}.amazonaws.com/client/register`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientName: KIRO_CONFIG.clientName,
        clientType: KIRO_CONFIG.clientType,
        scopes: KIRO_CONFIG.scopes,
        grantTypes: KIRO_CONFIG.grantTypes,
        issuerUrl: KIRO_CONFIG.issuerUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register client: ${error}`);
    }

    const data = await response.json();
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      clientSecretExpiresAt: data.clientSecretExpiresAt,
    };
  }

  /**
   * Start device authorization for AWS Builder ID or IDC
   */
  async startDeviceAuthorization(clientId, clientSecret, startUrl, region = "us-east-1") {
    const endpoint = `https://oidc.${region}.amazonaws.com/device_authorization`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        startUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to start device authorization: ${error}`);
    }

    const data = await response.json();
    return {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      verificationUriComplete: data.verificationUriComplete,
      expiresIn: data.expiresIn,
      interval: data.interval || 5,
    };
  }

  /**
   * Poll for token using device code (AWS Builder ID/IDC)
   */
  async pollDeviceToken(clientId, clientSecret, deviceCode, region = "us-east-1") {
    const endpoint = `https://oidc.${region}.amazonaws.com/token`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await response.json();

    // Handle pending/slow_down/errors
    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error,
        errorDescription: data.error_description,
        pending: data.error === "authorization_pending" || data.error === "slow_down",
      };
    }

    return {
      success: true,
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        tokenType: data.tokenType,
      },
    };
  }

  /**
   * Build Google/GitHub social login URL
   * Returns authorization URL for manual callback flow
   * Uses kiro:// custom protocol as required by AWS Cognito whitelist
   */
  buildSocialLoginUrl(provider, codeChallenge, state) {
    const idp = provider === "google" ? "Google" : "Github";
    // AWS Cognito only whitelists kiro:// protocol, not localhost
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";
    return `${KIRO_AUTH_SERVICE}/login?idp=${idp}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
  }

  /**
   * Exchange authorization code for tokens (Social Login)
   * Must use same redirect_uri as authorization request
   */
  async exchangeSocialCode(code, codeVerifier) {
    // Must match the redirect_uri used in buildSocialLoginUrl
    const redirectUri = "kiro://kiro.kiroAgent/authenticate-success";

    const response = await fetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
      idToken: data.idToken || data.id_token || null,
      email: data.email || null,
      loginHint: data.loginHint || data.login_hint || null,
    };
  }

  /**
   * Refresh token using refresh token
   */
  async refreshToken(refreshToken, providerSpecificData = {}) {
    const { authMethod, clientId, clientSecret, region } = providerSpecificData;

    // AWS SSO OIDC refresh (Builder ID or IDC)
    if (clientId && clientSecret) {
      const endpoint = `https://oidc.${region || "us-east-1"}.amazonaws.com/token`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
          refreshToken,
          grantType: "refresh_token",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data = await response.json();
      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || refreshToken,
        expiresIn: data.expiresIn,
        idToken: data.idToken || data.id_token || null,
        email: data.email || null,
        loginHint: data.loginHint || data.login_hint || null,
      };
    }

    // Social auth refresh (Google/GitHub)
    const response = await fetch(`${KIRO_AUTH_SERVICE}/refreshToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      profileArn: data.profileArn,
      expiresIn: data.expiresIn || 3600,
      idToken: data.idToken || data.id_token || null,
      email: data.email || null,
      loginHint: data.loginHint || data.login_hint || null,
    };
  }

  /**
   * Validate and import refresh token
   */
  async validateImportToken(refreshToken) {
    // Validate token format
    if (!refreshToken.startsWith("aorAAAAAG")) {
      throw new Error("Invalid token format. Token should start with aorAAAAAG...");
    }

    // Try to refresh to validate
    try {
      const result = await this.refreshToken(refreshToken);
      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        profileArn: result.profileArn,
        expiresIn: result.expiresIn,
        authMethod: "imported",
        idToken: result.idToken || null,
        email: result.email || null,
        loginHint: result.loginHint || null,
      };
    } catch (error) {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }

  /**
   * List available models from CodeWhisperer API
   */
  async listAvailableModels(accessToken, profileArn) {
    const endpoint = "https://codewhisperer.us-east-1.amazonaws.com";
    const target = "AmazonCodeWhispererService.ListAvailableModels";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": target,
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        origin: "AI_EDITOR",
        profileArn,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list models: ${error}`);
    }

    const data = await response.json();
    return (data.models || []).map(m => ({
      id: m.modelId,
      name: m.modelName || m.modelId,
      description: m.description,
      rateMultiplier: m.rateMultiplier,
      rateUnit: m.rateUnit,
      maxInputTokens: m.tokenLimits?.maxInputTokens || 0,
    }));
  }

  /**
   * Fetch user email from access token (optional, for display)
   */
  extractEmailFromJWT(accessToken) {
    const decoded = this.decodeJwtPayload(accessToken);
    return this.pickEmailCandidate(decoded?.email, decoded?.preferred_username);
  }
}
