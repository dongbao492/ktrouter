import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/kiro/social-exchange
 * Exchange authorization code for tokens (Google/GitHub social login)
 * Callback URL will be in format: kiro://kiro.kiroAgent/authenticate-success?code=XXX&state=YYY
 */
export async function POST(request) {
  try {
    const { code, codeVerifier, provider, state, expectedState } = await request.json();

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    if (expectedState && state && expectedState !== state) {
      return NextResponse.json(
        { error: "State mismatch" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();

    // Exchange code for tokens (redirect_uri handled internally)
    const tokenData = await kiroService.exchangeSocialCode(
      code,
      codeVerifier
    );

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
    } catch (error) {
      console.log("Kiro social resolveEmail failed/timeout:", error.message);
      email = kiroService.extractEmailFromJWT(tokenData.accessToken) || tokenData.loginHint || null;
    }

    // Save to database
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: provider, // "google" or "github"
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro social exchange error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
