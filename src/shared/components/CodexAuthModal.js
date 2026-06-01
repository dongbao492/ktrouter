"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

export default function CodexAuthModal({ isOpen, onMethodSelect, onImportSuccess, onClose }) {
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);

  const handleBack = () => {
    setSelectedMethod(null);
    setError(null);
    setResult(null);
  };

  const handleImport = async () => {
    if (!jsonText.trim()) {
      setError("Please paste JSON first");
      return;
    }

    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/oauth/codex/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: jsonText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      setResult(data);
      if (data.imported > 0) onImportSuccess?.(data);
    } catch (err) {
      setError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Codex" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {!selectedMethod && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted mb-4">
              Choose your authentication method:
            </p>

            <button
              onClick={() => onMethodSelect("browser")}
              className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">open_in_browser</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Browser Login</h3>
                  <p className="text-sm text-text-muted">
                    Login via browser with your ChatGPT/OpenAI account.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setSelectedMethod("import")}
              className="w-full p-4 text-left border border-border rounded-lg hover:bg-sidebar transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">upload</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Import Token</h3>
                  <p className="text-sm text-text-muted">
                    Paste 9router export JSON or ChatGPT session JSON.
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {selectedMethod === "import" && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Supports exported 9router JSON and ChatGPT session JSON from{" "}
                  <a
                    href="https://chatgpt.com/api/auth/session"
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono font-semibold underline underline-offset-2"
                  >
                    chatgpt.com/api/auth/session
                  </a>.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                JSON <span className="text-red-500">*</span>
              </label>
              <textarea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setError(null);
                  setResult(null);
                }}
                placeholder='{"version":1,"connections":[{"provider":"codex","accessToken":"..."}]}'
                spellCheck={false}
                className="min-h-56 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
            </div>

            {result && (
              <div className={`${result.imported > 0 ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"} p-3 rounded-lg border`}>
                <p className={`${result.imported > 0 ? "text-green-800 dark:text-green-200" : "text-yellow-800 dark:text-yellow-200"} text-sm`}>
                  {result.imported > 0
                    ? `Imported ${result.imported} account${result.imported === 1 ? "" : "s"}.`
                    : "No new accounts imported."}
                  {result.skipped ? ` ${result.skipped} skipped.` : ""}
                </p>
                {Array.isArray(result.results) && result.results.some((item) => item.status === "skipped") && (
                  <div className="mt-2 space-y-1 text-xs text-yellow-800 dark:text-yellow-200">
                    {result.results
                      .filter((item) => item.status === "skipped")
                      .map((item, index) => (
                        <p key={`${item.email || item.name || "skipped"}-${index}`} className="break-all">
                          {item.reason === "duplicate_email"
                            ? `${item.email || item.name || "Account"} already exists.`
                            : `${item.email || item.name || "Account"} skipped: ${item.reason || "unknown reason"}.`}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleImport} fullWidth disabled={importing || !jsonText.trim()}>
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth disabled={importing}>
                Back
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

CodexAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onMethodSelect: PropTypes.func.isRequired,
  onImportSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
