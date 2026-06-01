import { SignJWT, jwtVerify } from "jose";

export const DASHBOARD_AUTH_COOKIE_NAME = "ktrouter_session";
const ALG = "HS256";

function getSecret() {
  const raw = process.env.JWT_SECRET || globalThis.__cfEnv?.JWT_SECRET || "ktrouter-default-jwt-secret-change-me";
  return new TextEncoder().encode(raw);
}

export function shouldUseSecureCookie(request) {
  if (process.env.AUTH_COOKIE_SECURE === "false") return false;
  const proto = request?.headers?.get?.("x-forwarded-proto") || "";
  return proto === "https" || (request?.url || "").startsWith("https://");
}

export async function createDashboardAuthToken(claims = {}) {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

export async function getDashboardAuthSession(token) {
  const payload = await verifyDashboardAuthToken(token);
  if (!payload) return null;
  return { authenticated: true, ...payload };
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set(DASHBOARD_AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(request),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.set(DASHBOARD_AUTH_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}
