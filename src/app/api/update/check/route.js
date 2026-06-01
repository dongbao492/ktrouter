import { NextResponse } from "next/server";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";

export const dynamic = "force-dynamic";

function compareVersions(a, b) {
  const normalize = (version) =>
    String(version || "")
      .replace(/^v/i, "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = normalize(a);
  const right = normalize(b);

  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }

  return 0;
}

export async function GET() {
  const packageName = UPDATER_CONFIG.npmPackageName;
  const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

  try {
    const response = await fetch(registryUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.npm.install-v1+json, application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `npm registry returned HTTP ${response.status}`, packageName },
        { status: 502 }
      );
    }

    const latest = await response.json();
    const latestVersion = latest.version || null;
    const currentVersion = APP_CONFIG.version;
    const updateAvailable = Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0);

    return NextResponse.json({
      packageName,
      packageUrl: `https://www.npmjs.com/package/${packageName}`,
      currentVersion,
      latestVersion,
      updateAvailable,
      installCmd: UPDATER_CONFIG.installCmd,
      installCmdLatest: UPDATER_CONFIG.installCmdLatest,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to check npm updates", packageName },
      { status: 502 }
    );
  }
}
