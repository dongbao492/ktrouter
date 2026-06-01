"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, CardSkeleton, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const CAVEMAN_LEVELS = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
];

export default function APIPageClient() {
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState({});
  const [rtkEnabled, setRtkEnabled] = useState(true);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [baseUrl, setBaseUrl] = useState("");
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3008";
    setBaseUrl(`${origin}/v1`);
    (async () => {
      try {
        const [keysRes, settingsRes] = await Promise.all([fetch("/api/keys"), fetch("/api/settings")]);
        if (keysRes.ok) {
          const data = await keysRes.json();
          setKeys(data.keys || []);
        }
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setRequireApiKey(!!data.requireApiKey);
          setRtkEnabled(data.rtkEnabled !== false);
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const patchSetting = async (patch) => {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  };

  const createKey = async () => {
    const name = newKeyName.trim();
    if (!name) return;
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setKeys((prev) => [{ id: data.id, name: data.name, key: data.key, machineId: data.machineId }, ...prev]);
    setNewKeyName("");
    setShowCreateForm(false);
  };

  const toggleReveal = (id) => setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }));

  const maskKey = (key) => {
    if (!key) return "";
    const head = key.slice(0, 6);
    const tail = key.slice(-4);
    return `${head}${"*".repeat(4)}${tail}`;
  };

  const deleteKey = async (id) => {
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (res.ok) setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="material-symbols-outlined text-primary">api</span>
          API Endpoint
        </h2>
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-600 dark:text-green-400">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"></span>
              <span className="relative inline-flex size-1.5 rounded-full bg-green-500"></span>
            </span>
            Local
          </span>
          <Input value={baseUrl} readOnly className="flex-1 font-mono text-sm" />
          <button
            onClick={() => copy(baseUrl, "local_url")}
            className="shrink-0 rounded p-2 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-[18px]">{copied === "local_url" ? "check" : "content_copy"}</span>
          </button>
        </div>
      </Card>

      <Card id="rtk">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="material-symbols-outlined text-primary">bolt</span>
          Token Saver
        </h2>
        <div className="flex items-center justify-between border-b border-border pb-4 pt-2">
          <div>
            <p className="font-medium">Compress tool output (RTK)</p>
            <p className="text-sm text-text-muted">Reduce tool-result context for big outputs</p>
          </div>
          <Toggle
            checked={rtkEnabled}
            onChange={() => {
              const next = !rtkEnabled;
              setRtkEnabled(next);
              patchSetting({ rtkEnabled: next });
            }}
          />
        </div>
        <div className="flex items-center justify-between pb-2 pt-4">
          <div>
            <p className="font-medium">Caveman mode</p>
            <p className="text-sm text-text-muted">More concise instruction style</p>
          </div>
          <Toggle
            checked={cavemanEnabled}
            onChange={() => {
              const next = !cavemanEnabled;
              setCavemanEnabled(next);
              patchSetting({ cavemanEnabled: next });
            }}
          />
        </div>
        {cavemanEnabled && (
          <div className="mt-2 flex flex-wrap gap-2">
            {CAVEMAN_LEVELS.map((lvl) => (
              <button
                key={lvl.id}
                onClick={() => {
                  setCavemanLevel(lvl.id);
                  patchSetting({ cavemanLevel: lvl.id });
                }}
                className={`rounded-md border px-3 py-1.5 text-xs ${cavemanLevel === lvl.id ? "border-primary text-primary" : "border-border text-text-muted"}`}
                title={lvl.desc}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="material-symbols-outlined text-primary">key</span>
          API Keys
        </h2>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">When disabled, endpoint accepts unauthenticated requests.</p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => {
              const next = !requireApiKey;
              setRequireApiKey(next);
              patchSetting({ requireApiKey: next });
            }}
          />
        </div>
        <div className="mb-3 flex gap-2">
          {showCreateForm ? (
            <>
              <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="New key name" autoFocus onKeyDown={(e) => { if (e.key === "Enter") createKey(); if (e.key === "Escape") { setShowCreateForm(false); setNewKeyName(""); } }} />
              <Button onClick={createKey} disabled={!newKeyName.trim()}>Create</Button>
              <Button variant="ghost" onClick={() => { setShowCreateForm(false); setNewKeyName(""); }}>Cancel</Button>
            </>
          ) : (
            <Button onClick={() => setShowCreateForm(true)}>+ New API Key</Button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {keys.map((k) => {
            const revealed = revealedKeys[k.id];
            return (
              <div key={k.id} className="flex items-center gap-2 rounded border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{k.name || "Unnamed key"}</p>
                  <p className="truncate font-mono text-xs text-text-muted">{revealed ? k.key : maskKey(k.key)}</p>
                </div>
                <button
                  onClick={() => toggleReveal(k.id)}
                  className="shrink-0 rounded p-2 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                  title={revealed ? "Hide" : "Show"}
                >
                  <span className="material-symbols-outlined text-[18px]">{revealed ? "visibility_off" : "visibility"}</span>
                </button>
                <button
                  onClick={() => copy(k.key, `key_${k.id}`)}
                  className="shrink-0 rounded p-2 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                  title="Copy"
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === `key_${k.id}` ? "check" : "content_copy"}</span>
                </button>
                <Button variant="ghost" onClick={() => deleteKey(k.id)}>Delete</Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
