// All intercepted domains + URL patterns per tool

const TARGET_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];

const URL_PATTERNS = {
  antigravity: [":generateContent", ":streamGenerateContent"],
  copilot: ["/chat/completions", "/v1/messages", "/responses"],
  kiro: ["/generateAssistantResponse"],
  cursor: ["/BidiAppend", "/RunSSE", "/RunPoll", "/Run"],
};

// Synonym map: rawModel from request → canonical alias key in mitmAlias DB
const MODEL_SYNONYMS = {
  antigravity: {
    "gemini-default": "gemini-3.5-flash-high",
    "gemini-3-flash-agent": "gemini-3.5-flash-high",
    "gemini-3-flash": "gemini-3.5-flash-medium",
    "gemini-3.0-flash": "gemini-3.5-flash-medium",
    "gemini-3-pro": "gemini-3.1-pro-high",
    "gemini-3.1-pro": "gemini-3.1-pro-high",
    "gemini-3.5-flash": "gemini-3.5-flash-high",
    "gemini-3.5-flash-low": "gemini-3.5-flash-low",
    "gemini-pro-agent": "gemini-3.1-pro-high",
    "claude-sonnet-4-6": "claude-sonnet-4-6-thinking",
    "claude-opus-4-6": "claude-opus-4-6-thinking",
    "gpt-oss-120b": "gpt-oss-120b-medium",
  },
};

// Pattern fallback: raw model label/id -> canonical alias key.
const MODEL_PATTERNS = {
  antigravity: [
    { match: /flash.*high|high.*flash/i, alias: "gemini-3.5-flash-high" },
    { match: /flash.*medium|medium.*flash/i, alias: "gemini-3.5-flash-medium" },
    { match: /flash.*low|low.*flash/i, alias: "gemini-3.5-flash-low" },
    { match: /flash/i, alias: "gemini-3.5-flash-medium" },
    { match: /pro.*low|low.*pro/i, alias: "gemini-3.1-pro-low" },
    { match: /gemini.*pro|pro.*gemini/i, alias: "gemini-3.1-pro-high" },
    { match: /opus/i, alias: "claude-opus-4-6-thinking" },
    { match: /sonnet|claude/i, alias: "claude-sonnet-4-6-thinking" },
    { match: /gpt.*oss|oss/i, alias: "gpt-oss-120b-medium" },
  ],
};

// URL substrings whose request/response should NOT be dumped to file (telemetry, polling, empty)
const LOG_BLACKLIST_URL_PARTS = [
  "recordCodeAssistMetrics",
  "recordTrajectoryAnalytics",
  "fetchAdminControls",
  "listExperiments",
];

function getToolForHost(host) {
  const h = (host || "").split(":")[0];
  if (h === "api.individual.githubcopilot.com") return "copilot";
  if (h === "daily-cloudcode-pa.googleapis.com" || h === "cloudcode-pa.googleapis.com") return "antigravity";
  if (h === "q.us-east-1.amazonaws.com" || h === "codewhisperer.us-east-1.amazonaws.com") return "kiro";
  if (h === "api2.cursor.sh") return "cursor";
  return null;
}

module.exports = { TARGET_HOSTS, URL_PATTERNS, MODEL_SYNONYMS, MODEL_PATTERNS, LOG_BLACKLIST_URL_PARTS, getToolForHost };
