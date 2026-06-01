"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * Kiro Browser Login Modal
 * Opens browser to app.kiro.dev/signin with localhost callback
 * Polls for callback result and exchanges code for tokens
 * Also supports manual callback URL paste
 */
export default function KiroBrowserLoginModal({ isOpen, onSuccess, onClose }) {
  const [status, setStatus] = useState("idle"); // idle | starting | waiting | exchanging | success | error
  const [authUrl, setAuthUrl] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState(null);
  const [manualUrl, setManualUrl] = useState("");
  const [showManual, setShowManual] = useState(false);
  const pollRef = useRef(null);
  const startedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelLogin = useCallback(async () => {
    cleanup();
    try {
      await fetch("/api/oauth/kiro/browser-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch {}
  }, [cleanup]);

  const doExchange = useCallback(async () => {
    setStatus("exchanging");
    setError(null);
    try {
      const exchangeRes = await fetch("/api/oauth/kiro/browser-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exchange" }),
      });

      const exchangeData = await exchangeRes.json();
      if (!exchangeRes.ok || !exchangeData.success) {
        throw new Error(exchangeData.error || "Token exchange failed");
      }

      setEmail(exchangeData.connection?.email || null);
      setStatus("success");
      setTimeout(() => {
        onSuccess?.();
      }, 1500);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, [onSuccess]);

  const handleManualSubmit = useCallback(async () => {
    if (!manualUrl.trim()) return;

    try {
      // Submit the manual callback URL to the server
      const res = await fetch("/api/oauth/kiro/browser-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual-callback", callbackUrl: manualUrl.trim() }),
      });

      const data = await res.json();
      if (!res.ok || data.status === "error") {
        throw new Error(data.error || "Invalid callback URL");
      }

      // Now exchange
      await doExchange();
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, [manualUrl, doExchange]);

  const startLogin = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus("starting");
    setError(null);
    setShowManual(false);

    try {
      const res = await fetch("/api/oauth/kiro/browser-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start login");
      }

      setAuthUrl(data.authUrl);
      setStatus("waiting");

      // Open browser
      window.open(data.authUrl, "_blank");

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch("/api/oauth/kiro/browser-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll" }),
          });

          const pollData = await pollRes.json();

          if (pollData.status === "completed") {
            cleanup();
            await doExchange();
          } else if (pollData.status === "error") {
            cleanup();
            setError(pollData.error || "Login failed");
            setStatus("error");
          } else if (pollData.status === "expired") {
            cleanup();
            setError("Login expired. Please try again.");
            setStatus("error");
          } else if (pollData.status === "no_pending_login") {
            cleanup();
            setError("No pending login found.");
            setStatus("error");
          }
        } catch (err) {
          // Ignore poll errors, keep trying
        }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setStatus("error");
      startedRef.current = false;
    }
  }, [cleanup, doExchange]);

  useEffect(() => {
    if (isOpen && status === "idle") {
      startLogin();
    }
  }, [isOpen, status, startLogin]);

  useEffect(() => {
    return () => {
      cleanup();
      startedRef.current = false;
    };
  }, [cleanup]);

  const handleClose = () => {
    cancelLogin();
    setStatus("idle");
    setAuthUrl(null);
    setError(null);
    setEmail(null);
    setManualUrl("");
    setShowManual(false);
    startedRef.current = false;
    onClose?.();
  };

  const handleRetry = () => {
    setStatus("idle");
    setError(null);
    setManualUrl("");
    setShowManual(false);
    startedRef.current = false;
    startLogin();
  };

  return (
    <Modal isOpen={isOpen} title="Kiro Browser Login" onClose={handleClose} size="md">
      <div className="flex flex-col gap-4">
        {/* Starting */}
        {status === "starting" && (
          <div className="text-center py-8">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Starting login...</h3>
            <p className="text-sm text-text-muted">Preparing callback server</p>
          </div>
        )}

        {/* Waiting for callback */}
        {status === "waiting" && (
          <div className="py-2">
            {/* Status indicator with loading animation */}
            <div className="flex items-center gap-3 mb-5 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-200/30 dark:via-blue-400/10 to-transparent animate-[shimmer_2s_infinite]" style={{ animation: "shimmer 2s infinite" }} />
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 animate-spin text-xl relative">progress_activity</span>
              <div className="flex-1 relative">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Waiting for authorization...</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">Complete the login in your browser</p>
              </div>
            </div>

            {/* Login URL box */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-text-muted mb-1.5">Login URL</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-sidebar border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-muted truncate select-all">
                  {authUrl}
                </div>
                <button
                  onClick={(e) => {
                    navigator.clipboard.writeText(authUrl);
                    const btn = e.currentTarget;
                    const icon = btn.querySelector("span");
                    icon.textContent = "check";
                    btn.classList.add("text-green-600", "border-green-500");
                    setTimeout(() => {
                      icon.textContent = "content_copy";
                      btn.classList.remove("text-green-600", "border-green-500");
                    }, 2000);
                  }}
                  className="flex items-center justify-center border border-border rounded-lg px-2.5 hover:bg-sidebar transition-all"
                  title="Copy URL"
                >
                  <span className="material-symbols-outlined text-lg">content_copy</span>
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mb-4">
              <a
                href={authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium bg-primary text-white rounded-lg px-3 py-2.5 hover:bg-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-base">open_in_new</span>
                Open in Browser
              </a>
            </div>

            {/* Manual callback URL */}
            <div className="border-t border-border pt-3">
              {!showManual ? (
                <button
                  onClick={() => setShowManual(true)}
                  className="w-full text-xs text-text-muted hover:text-primary transition-colors flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">link</span>
                  Enter callback URL manually
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-text-muted">
                    Paste callback URL from browser:
                  </label>
                  <Input
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="http://localhost:3128/oauth/callback?code=...&state=..."
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={handleManualSubmit}
                    size="sm"
                    fullWidth
                    disabled={!manualUrl.trim()}
                  >
                    Submit
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Exchanging tokens */}
        {status === "exchanging" && (
          <div className="text-center py-8">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Exchanging tokens...</h3>
            <p className="text-sm text-text-muted">Almost done</p>
          </div>
        )}

        {/* Success */}
        {status === "success" && (
          <div className="text-center py-8">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600 dark:text-green-400">
                check_circle
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected!</h3>
            {email && (
              <p className="text-sm text-text-muted">{email}</p>
            )}
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600 dark:text-red-400">
                error
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Login Failed</h3>
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
            <div className="flex gap-2 justify-center">
              <Button onClick={handleRetry}>Try Again</Button>
              <Button onClick={handleClose} variant="ghost">Cancel</Button>
            </div>
          </div>
        )}

        {/* Cancel button for waiting/starting state */}
        {(status === "waiting" || status === "starting") && (
          <Button onClick={handleClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        )}
      </div>
    </Modal>
  );
}

KiroBrowserLoginModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
