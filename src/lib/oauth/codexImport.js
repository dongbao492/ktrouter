const BASE64_BLOCK_SIZE = 4;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((BASE64_BLOCK_SIZE - (normalized.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE);
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseJwtPayload(token) {
  if (typeof token !== "string" || token.trim() === "") return undefined;
  const segments = token.split(".");
  if (segments.length < 2) return undefined;
  try {
    return JSON.parse(decodeBase64Url(segments[1]));
  } catch {
    return undefined;
  }
}

function getOpenAIAuthSection(payload) {
  if (!isPlainObject(payload)) return {};
  const auth = payload["https://api.openai.com/auth"];
  return isPlainObject(auth) ? auth : {};
}

function getOpenAIProfileSection(payload) {
  if (!isPlainObject(payload)) return {};
  const profile = payload["https://api.openai.com/profile"];
  return isPlainObject(profile) ? profile : {};
}

function normalizeTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1e11 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function epochSecondsFromValue(value) {
  if (value === undefined || value === null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
}

function buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt) {
  if (!accountId) return undefined;

  const now = Math.trunc(Date.now() / 1000);
  const authInfo = { chatgpt_account_id: accountId };
  const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;

  if (planType) authInfo.chatgpt_plan_type = planType;
  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }

  const payload = {
    iat: now,
    exp: expires,
    "https://api.openai.com/auth": authInfo,
    ...(email ? { email } : {}),
  };

  return `${encodeBase64UrlJson({ alg: "none", typ: "JWT", cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.synthetic`;
}

function stripUnavailable(value) {
  if (Array.isArray(value)) {
    return value.map(stripUnavailable).filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, stripUnavailable(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  if (value === undefined || value === null || value === "") return undefined;
  return value;
}

function collectSessionLikeObjects(value, sourceName = "pasted-json") {
  const found = [];
  const visited = new WeakSet();

  function visit(item, path) {
    if (!isPlainObject(item) && !Array.isArray(item)) return;

    if (isPlainObject(item)) {
      if (visited.has(item)) return;
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        item.token?.accessToken,
        item.token?.access_token,
        item.credentials?.accessToken,
        item.credentials?.access_token,
      );
      const hasIdentity = isPlainObject(item.user) || firstNonEmpty(
        item.email,
        item.name,
        item.providerSpecificData?.chatgptAccountId,
        item.providerSpecificData?.chatgpt_account_id,
        item.id,
      );
      const supportedProvider = !item.provider || item.provider === "codex";
      if (token && hasIdentity && supportedProvider) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === "accessToken" || key === "access_token" || key === "sessionToken") continue;
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, "$");
  return found;
}

function normalizeExportConnection(record) {
  if (!isPlainObject(record)) throw new Error("connection is not an object");
  const provider = record.provider || "codex";
  if (provider !== "codex") return null;

  const accessToken = firstNonEmpty(record.accessToken, record.access_token);
  if (!accessToken) throw new Error("Missing accessToken");

  const idToken = firstNonEmpty(record.idToken, record.id_token);
  const idPayload = parseJwtPayload(idToken);
  const idAuth = getOpenAIAuthSection(idPayload);
  const providerSpecificData = {
    ...(isPlainObject(record.providerSpecificData) ? record.providerSpecificData : {}),
  };
  const chatgptAccountId = firstNonEmpty(
    providerSpecificData.chatgptAccountId,
    providerSpecificData.chatgpt_account_id,
    idAuth.chatgpt_account_id,
  );
  const chatgptPlanType = firstNonEmpty(
    providerSpecificData.chatgptPlanType,
    providerSpecificData.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  );
  if (chatgptAccountId) providerSpecificData.chatgptAccountId = chatgptAccountId;
  if (chatgptPlanType) providerSpecificData.chatgptPlanType = chatgptPlanType;

  return stripUnavailable({
    provider: "codex",
    authType: record.authType || "oauth",
    accessToken,
    refreshToken: firstNonEmpty(record.refreshToken, record.refresh_token),
    idToken,
    expiresAt: normalizeTimestamp(record.expiresAt || record.expires_at || record.expired),
    email: firstNonEmpty(record.email, idPayload?.email),
    name: firstNonEmpty(record.name, record.email, idPayload?.email),
    priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : undefined,
    isActive: typeof record.isActive === "boolean" ? record.isActive : !Boolean(record.disabled),
    providerSpecificData,
    testStatus: firstNonEmpty(record.testStatus, record.test_status, "active"),
  });
}

function convertSession(record) {
  if (!isPlainObject(record)) throw new Error("session is not an object");

  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    record.token?.accessToken,
    record.token?.access_token,
    record.credentials?.accessToken,
    record.credentials?.access_token,
  );
  if (!accessToken) throw new Error("Missing accessToken");

  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    record.token?.refreshToken,
    record.token?.refresh_token,
    record.credentials?.refresh_token,
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    record.token?.idToken,
    record.token?.id_token,
    record.credentials?.id_token,
  );

  const payload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);
  const expiresAt = firstNonEmpty(
    payload ? timestampFromUnixSeconds(payload.exp) : undefined,
    normalizeTimestamp(record.expires),
    normalizeTimestamp(record.expiresAt),
    normalizeTimestamp(record.expired),
    normalizeTimestamp(record.expires_at),
  );
  const email = firstNonEmpty(
    record.user?.email,
    record.email,
    record.credentials?.email,
    record.providerSpecificData?.email,
    profile.email,
    idPayload?.email,
    payload?.email,
  );
  const accountId = firstNonEmpty(
    record.account?.id,
    record.account_id,
    record.chatgptAccountId,
    record.providerSpecificData?.chatgptAccountId,
    record.providerSpecificData?.chatgpt_account_id,
    record.credentials?.chatgpt_account_id,
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === "codex" ? record.id : undefined,
  );
  const userId = firstNonEmpty(
    record.user?.id,
    record.user_id,
    record.chatgptUserId,
    record.providerSpecificData?.chatgptUserId,
    record.providerSpecificData?.chatgpt_user_id,
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  );
  const planType = firstNonEmpty(
    record.account?.planType,
    record.account?.plan_type,
    record.planType,
    record.plan_type,
    record.providerSpecificData?.chatgptPlanType,
    record.providerSpecificData?.chatgpt_plan_type,
    record.credentials?.plan_type,
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  );
  const idToken = firstNonEmpty(inputIdToken, buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt));
  const providerSpecificData = {
    ...(isPlainObject(record.providerSpecificData) ? record.providerSpecificData : {}),
    workspaceId: firstNonEmpty(record.providerSpecificData?.workspaceId, record.providerSpecificData?.workspace_id, accountId),
    workspacePlanType: firstNonEmpty(record.providerSpecificData?.workspacePlanType, record.providerSpecificData?.workspace_plan_type, planType),
    chatgptUserId: firstNonEmpty(record.providerSpecificData?.chatgptUserId, record.providerSpecificData?.chatgpt_user_id, userId),
    organizations: record.providerSpecificData?.organizations,
    chatgptAccountId: accountId,
    chatgptPlanType: planType,
  };

  return stripUnavailable({
    provider: "codex",
    authType: "oauth",
    accessToken,
    refreshToken,
    idToken,
    expiresAt,
    testStatus: firstNonEmpty(record.testStatus, record.test_status, "active"),
    providerSpecificData,
    id: firstNonEmpty(record.id, accountId),
    name: firstNonEmpty(email, record.name, "ChatGPT Account"),
    email,
    priority: Number.isFinite(Number(record.priority)) ? Number(record.priority) : undefined,
    isActive: typeof record.isActive === "boolean" ? record.isActive : !Boolean(record.disabled),
  });
}

function normalizeCodexConnections(input) {
  if (isPlainObject(input) && Array.isArray(input.connections)) {
    return input.connections.map(normalizeExportConnection).filter(Boolean);
  }

  if (Array.isArray(input)) {
    return input.map((item) => {
      if (isPlainObject(item) && (item.accessToken || item.access_token) && (item.provider || item.authType || item.providerSpecificData)) {
        return normalizeExportConnection(item);
      }
      return convertSession(item);
    }).filter(Boolean);
  }

  if (isPlainObject(input) && (input.access_token || input.id_token || input.type === "codex")) {
    return [normalizeExportConnection({
      provider: "codex",
      authType: "oauth",
      accessToken: input.access_token,
      refreshToken: input.refresh_token,
      idToken: input.id_token,
      expiresAt: input.expired,
      email: input.email,
      name: input.account_note || input.email,
      providerSpecificData: {
        chatgptAccountId: input.account_id,
      },
    })];
  }

  const sessions = collectSessionLikeObjects(input);
  return sessions.map((item) => convertSession(item.value));
}

function cleanPastedJsonText(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonCandidate(text) {
  const cleaned = cleanPastedJsonText(text);
  const firstObject = cleaned.indexOf("{");
  const firstArray = cleaned.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";

  if (firstObject >= 0 && (firstArray < 0 || firstObject < firstArray)) {
    start = firstObject;
    open = "{";
    close = "}";
  } else if (firstArray >= 0) {
    start = firstArray;
    open = "[";
    close = "]";
  }

  if (start < 0) return cleaned;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return cleaned.slice(start, index + 1);
  }

  return cleaned.slice(start);
}

export function parseCodexImportJson(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("JSON is required");
  }
  let parsed;
  const candidate = extractJsonCandidate(text);
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }

  const connections = normalizeCodexConnections(parsed);
  if (!connections.length) {
    throw new Error("No Codex accounts found in JSON");
  }

  return connections;
}
