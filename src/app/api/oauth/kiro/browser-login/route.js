import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { createServer } from "http";

const KIRO_AUTH_PORTAL_URL = "https://app.kiro.dev/signin";
const KIRO_AUTH_SERVICE = "https://prod.us-east-1.auth.desktop.kiro.dev";
const CALLBACK_PORT_CANDIDATES = [3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153];
const OAUTH_TIMEOUT_MS = 600_000; // 10 minutes

// In-memory pending login state
let pendingLogin = null;

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    let tried = 0;
    function tryPort(idx) {
      if (idx >= CALLBACK_PORT_CANDIDATES.length) {
        // Fallback: let OS pick
        const s = createServer();
        s.listen(0, "127.0.0.1", () => {
          const port = s.address().port;
          s.close(() => resolve(port));
        });
        s.on("error", reject);
        return;
      }
      const port = CALLBACK_PORT_CANDIDATES[idx];
      const s = createServer();
      s.once("error", () => tryPort(idx + 1));
      s.listen(port, "127.0.0.1", () => {
        s.close(() => resolve(port));
      });
    }
    tryPort(0);
  });
}

function startCallbackServer(port, stateToken) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const path = url.pathname;

      // Kiro redirects to /oauth/callback or /signin/callback
      if (path === "/oauth/callback" || path === "/signin/callback" || path === "/callback" || path === "/") {
        const params = Object.fromEntries(url.searchParams.entries());

        // Check for error
        if (params.error) {
          if (pendingLogin) {
            pendingLogin.callbackResult = { error: params.error, error_description: params.error_description };
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<html><body style="font-family:system-ui;text-align:center;padding:60px">
            <h2>\u274C Login failed</h2>
            <p>${params.error_description || params.error}</p>
          </body></html>`);
          setTimeout(() => server.close(), 1000);
          return;
        }

        // Validate state
        if (params.state && params.state !== stateToken) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<html><body><h2>State mismatch - login failed</h2></body></html>");
          return;
        }

        // Store callback result
        if (pendingLogin) {
          pendingLogin.callbackResult = params;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="font-family:system-ui;text-align:center;padding:60px">
          <h2>\u2705 Login th\u00e0nh c\u00f4ng!</h2>
          <p>B\u1ea1n c\u00f3 th\u1ec3 \u0111\u00f3ng tab n\u00e0y v\u00e0 quay l\u1ea1i KTRouter.</p>
          <script>window.close()</script>
        </body></html>`);

        // Close server after response
        setTimeout(() => server.close(), 1000);
      } else if (path === "/cancel") {
        if (pendingLogin) {
          pendingLogin.callbackResult = { error: "cancelled" };
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("cancelled");
        setTimeout(() => server.close(), 500);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });

    server.on("error", () => {
      resolve(null);
    });

    // Auto-close after timeout
    setTimeout(() => {
      try { server.close(); } catch {}
    }, OAUTH_TIMEOUT_MS);
  });
}

/**
 * POST /api/oauth/kiro/browser-login
 * action: "start" | "poll" | "cancel" | "exchange"
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "start") {
      // Clean up previous login
      if (pendingLogin?.server) {
        try { pendingLogin.server.close(); } catch {}
      }

      const { codeVerifier, codeChallenge, state } = generatePKCE();

      // Find available port and start callback server
      const port = await findAvailablePort();
      const server = await startCallbackServer(port, state);

      if (!server) {
        return NextResponse.json({ error: "Failed to start callback server" }, { status: 500 });
      }

      // redirect_uri must be http://localhost:{port} (no path) — Kiro appends /oauth/callback
      const callbackUrl = `http://localhost:${port}`;

      // Build auth URL matching cockpit-tools format
      const authUrl = `${KIRO_AUTH_PORTAL_URL}?state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&redirect_uri=${encodeURIComponent(callbackUrl)}&redirect_from=KiroIDE`;

      pendingLogin = {
        loginId: state,
        codeVerifier,
        codeChallenge,
        state,
        port,
        server,
        callbackUrl,
        callbackResult: null,
        expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
      };

      return NextResponse.json({
        success: true,
        loginId: state,
        authUrl,
        callbackUrl,
        expiresIn: OAUTH_TIMEOUT_MS / 1000,
      });
    }

    if (action === "poll") {
      if (!pendingLogin) {
        return NextResponse.json({ status: "no_pending_login" });
      }

      if (Date.now() > pendingLogin.expiresAt) {
        if (pendingLogin.server) try { pendingLogin.server.close(); } catch {}
        pendingLogin = null;
        return NextResponse.json({ status: "expired" });
      }

      if (pendingLogin.callbackResult) {
        if (pendingLogin.callbackResult.error) {
          const err = pendingLogin.callbackResult.error_description || pendingLogin.callbackResult.error;
          pendingLogin = null;
          return NextResponse.json({ status: "error", error: err });
        }
        return NextResponse.json({
          status: "completed",
          callbackData: pendingLogin.callbackResult,
        });
      }

      return NextResponse.json({ status: "waiting" });
    }

    if (action === "exchange") {
      if (!pendingLogin || !pendingLogin.callbackResult) {
        return NextResponse.json({ error: "No callback data available" }, { status: 400 });
      }

      const { callbackResult, codeVerifier, callbackUrl } = pendingLogin;
      const code = callbackResult.code;
      const loginOption = callbackResult.login_option || callbackResult.loginOption || "";
      const issuerUrl = callbackResult.issuer_url || callbackResult.issuerUrl || "";
      const idcRegion = callbackResult.idc_region || callbackResult.idcRegion || "";
      const clientId = callbackResult.client_id || callbackResult.clientId || "";
      const scopes = callbackResult.scopes || callbackResult.scope || "";
      const loginHint = callbackResult.login_hint || callbackResult.loginHint || "";

      if (!code) {
        pendingLogin = null;
        return NextResponse.json({ error: "No authorization code received" }, { status: 400 });
      }

      const kiroService = new KiroService();

      // Exchange code for tokens — always use Kiro token endpoint (like cockpit-tools)
      // redirect_uri must be: {baseUrl}{callbackPath}?login_option={loginOption}
      const callbackPath = callbackResult.path || "/oauth/callback";
      const exchangeRedirectUri = `${callbackUrl}${callbackPath.startsWith("/") ? callbackPath : "/" + callbackPath}?login_option=${encodeURIComponent(loginOption)}`;
      
      const response = await fetch(`${KIRO_AUTH_SERVICE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          code_verifier: codeVerifier,
          redirect_uri: exchangeRedirectUri,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.log("Kiro token exchange error:", response.status, errText);
        pendingLogin = null;
        return NextResponse.json({ error: `Token exchange failed (${response.status}): ${errText}` }, { status: 500 });
      }

      const data = await response.json();
      const tokenData = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn || 3600,
        profileArn: data.profileArn || null,
        authMethod: loginOption || "browser",
        idToken: data.idToken || data.id_token || null,
        loginHint: data.loginHint || data.login_hint || loginHint || null,
        idcRegion: idcRegion || null,
        clientId: clientId || null,
        clientSecret: data.clientSecret || null,
      };

      // Resolve email (with timeout to avoid hanging)
      let email = null;
      try {
        const emailPromise = kiroService.resolveEmail({
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          tokenData,
          profileArn: tokenData.profileArn,
        });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000));
        email = await Promise.race([emailPromise, timeoutPromise]);
      } catch (e) {
        console.log("Kiro resolveEmail failed/timeout:", e.message);
        // Fallback: try to extract from JWT
        email = kiroService.extractEmailFromJWT(tokenData.accessToken) || tokenData.loginHint || null;
      }

      // Save to database
      const connection = await createProviderConnection({
        provider: "kiro",
        authType: "oauth",
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
        email: email || tokenData.loginHint || loginHint || null,
        providerSpecificData: {
          profileArn: tokenData.profileArn || null,
          authMethod: tokenData.authMethod,
          provider: loginOption || "Browser",
          idcRegion: idcRegion || null,
          clientId: clientId || null,
          clientSecret: tokenData.clientSecret || null,
          issuerUrl: issuerUrl || null,
          scopes: scopes || null,
        },
        testStatus: "active",
      });

      // Cleanup
      pendingLogin = null;

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
        },
      });
    }

    if (action === "manual-callback") {
      // User manually pastes the callback URL from browser
      const { callbackUrl: manualCallbackUrl } = body;
      if (!manualCallbackUrl || !pendingLogin) {
        return NextResponse.json({ error: "No pending login or missing URL" }, { status: 400 });
      }

      try {
        const url = new URL(manualCallbackUrl);
        const params = Object.fromEntries(url.searchParams.entries());

        if (params.error) {
          pendingLogin = null;
          return NextResponse.json({ status: "error", error: params.error_description || params.error });
        }

        if (!params.code) {
          return NextResponse.json({ error: "No code found in URL" }, { status: 400 });
        }

        // Validate state if present
        if (params.state && params.state !== pendingLogin.state) {
          return NextResponse.json({ error: "State mismatch" }, { status: 400 });
        }

        // Store as callback result
        pendingLogin.callbackResult = params;
        return NextResponse.json({ status: "completed" });
      } catch (e) {
        return NextResponse.json({ error: "Invalid URL: " + e.message }, { status: 400 });
      }
    }

    if (action === "cancel") {
      if (pendingLogin?.server) {
        try { pendingLogin.server.close(); } catch {}
      }
      pendingLogin = null;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.log("Kiro browser login error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
