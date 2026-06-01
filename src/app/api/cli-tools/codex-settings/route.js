"use server";

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parseTOML, stringifyTOML } from "confbox";

const execFileAsync = promisify(execFile);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

const isDirectProviderModel = (value) => {
  if (!value || typeof value !== "string") return false;
  const firstSlash = value.indexOf("/");
  return firstSlash > 0 && firstSlash < value.length - 1;
};

// Flatten confbox-parsed TOML into a writable object, preserving nested tables
const parsedToWritable = (obj) => obj ?? {};

// Set a nested key from a flat dotted path, creating intermediate objects as needed
const setNestedSection = (obj, dottedKey, value) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
};

// Delete a nested key from a flat dotted path
const deleteNestedSection = (obj, dottedKey) => {
  const keys = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur?.[keys[i]];
    if (cur == null) return;
  }
  delete cur[keys[keys.length - 1]];
};

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const file = isWindows ? "where" : "which";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execFileAsync(file, ["codex"], { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const tomlPath = getCodexConfigPath();
    const tomlContent = await fs.readFile(tomlPath, "utf-8");
    return { content: tomlContent, format: "toml", path: tomlPath };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has KTRouter settings
const hasKTRouterConfig = (config) => {
  if (!config) return false;
  return (
    config.includes("model_provider = \"ktrouter\"") ||
    config.includes("[model_providers.quoctai]")
  );
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const configData = await readConfig();
    const config = configData?.content || null;

    return NextResponse.json({
      installed: true,
      config,
      hasKTRouter: hasKTRouterConfig(config),
      configPath: configData?.path || getCodexConfigPath(),
      configFormat: "toml",
    });
  } catch (error) {
    console.log("Error checking codex settings:", error);
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update KTRouter settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel, reasoningEffort, wireApi } = await request.json();

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }
    if (!isDirectProviderModel(model)) {
      return NextResponse.json(
        { error: "Codex model must use direct provider/model format; combos and bare aliases are not supported" },
        { status: 400 },
      );
    }
    if (subagentModel && !isDirectProviderModel(subagentModel)) {
      return NextResponse.json(
        { error: "Codex subagent model must use direct provider/model format, or be omitted" },
        { status: 400 },
      );
    }

    const codexDir = getCodexDir();
    const configPath = getCodexConfigPath();

    // Ensure directory exists
    await fs.mkdir(codexDir, { recursive: true });

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch { /* No existing config */ }

    // Update only KTRouter related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "quoctai";
    if (reasoningEffort && reasoningEffort !== "none") {
      parsed.model_reasoning_effort = reasoningEffort;
    } else {
      delete parsed.model_reasoning_effort;
    }

    // Update or create ktrouter provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    setNestedSection(parsed, "model_providers.quoctai", {
      name: "QuocTai",
      base_url: normalizedBaseUrl,
      wire_api: wireApi || "responses",
    });

    // Add subagent configuration
    const effectiveSubagentModel = subagentModel || model;
    setNestedSection(parsed, "agents.subagent", {
      model: effectiveSubagentModel,
    });

    // Default large context window for better performance
    parsed.model_context_window = 1000000;

    // This tool writes direct provider/model selections only.
    deleteNestedSection(parsed, "notice.model_migrations");

    // Write merged TOML config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Update auth.json with OPENAI_API_KEY (Codex reads this first)
    const authPath = getCodexAuthPath();
    let authData = {};
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      authData = JSON.parse(existingAuth);
    } catch { /* No existing auth */ }

    // Force apikey mode (keep existing tokens untouched for ChatGPT login reuse)
    authData.OPENAI_API_KEY = apiKey;
    authData.auth_mode = "apikey";
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.log("Error updating codex settings:", error);
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove KTRouter settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parsedToWritable(parseTOML(existingConfig));
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove KTRouter related root fields only if they point to ktrouter
    if (parsed.model_provider === "quoctai") {
      delete parsed.model;
      delete parsed.model_provider;
    }

    // Remove ktrouter provider section
    deleteNestedSection(parsed, "model_providers.quoctai");
    delete parsed.model_reasoning_effort;
    deleteNestedSection(parsed, "notice.model_migrations");

    // Remove subagent configuration
    deleteNestedSection(parsed, "agents.subagent");

    // Write updated config
    const configContent = stringifyTOML(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;

      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch { /* No auth file */ }

    return NextResponse.json({
      success: true,
      message: "KTRouter settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting codex settings:", error);
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}
