import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { cleanupProviderConnections, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import {
  getMitmStatus,
  startMitm,
  loadEncryptedPassword,
  initDbHooks,
  restoreToolDNS,
  removeAllDNSEntriesSync,
} from "@/mitm/manager";
import { syncToJson as syncMitmAliasCache } from "@/lib/mitmAliasCache";

(function bootstrapMitm() {
  if (!process.env.MITM_SERVER_PATH) {
    try {
      const thisFile = fileURLToPath(import.meta.url);
      const appSrc = dirname(dirname(thisFile));
      const candidate = join(appSrc, "mitm", "server.js");
      if (existsSync(candidate)) process.env.MITM_SERVER_PATH = candidate;
    } catch {}
  }
  try {
    initDbHooks(getSettings, updateSettings);
  } catch {}
})();

const g = global.__appSingleton ??= {
  signalHandlersRegistered: false,
  mitmStartInProgress: false,
};

export async function initializeApp() {
  try {
    await cleanupProviderConnections();

    if (!g.signalHandlersRegistered) {
      const cleanup = () => {
        try {
          removeAllDNSEntriesSync();
        } catch {}
        process.exit();
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
      process.on("exit", () => {
        try {
          removeAllDNSEntriesSync();
        } catch {}
      });
      g.signalHandlersRegistered = true;
    }

    syncMitmAliasCache().catch(() => {});
    autoStartMitm();
  } catch (error) {
    console.error("[InitApp] Error:", error);
  }
}

async function autoStartMitm() {
  if (g.mitmStartInProgress) return;
  g.mitmStartInProgress = true;
  try {
    const settings = await getSettings();
    if (!settings.mitmEnabled) return;
    const mitmStatus = await getMitmStatus();
    if (mitmStatus.running) return;

    const password = await loadEncryptedPassword();
    if (!password && process.platform !== "win32") return;

    const keys = await getApiKeys();
    const activeKey = keys.find((k) => k.isActive !== false);

    await startMitm(activeKey?.key || "sk_ktrouter", password);
    try {
      await restoreToolDNS(password);
    } catch {}
  } catch (err) {
    console.log("[InitApp] MITM auto-start failed:", err.message);
  } finally {
    g.mitmStartInProgress = false;
  }
}

export default initializeApp;
