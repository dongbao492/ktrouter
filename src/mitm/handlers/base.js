const { log, err } = require("../logger");

const DEFAULT_LOCAL_ROUTER = "http://localhost:3008";
const ROUTER_BASE = String(process.env.MITM_ROUTER_BASE || DEFAULT_LOCAL_ROUTER)
  .trim()
  .replace(/\/+$/, "") || DEFAULT_LOCAL_ROUTER;
const API_KEY = process.env.ROUTER_API_KEY;

// Headers that must not be forwarded to KTRouter
const STRIP_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding",
  "content-type", "authorization"
]);

/**
 * Send body to KTRouter at the given path and return the fetch Response object.
 * Optionally forwards client headers (stripped of hop-by-hop / overridden keys).
 */
async function fetchRouter(openaiBody, path = "/v1/chat/completions", clientHeaders = {}) {
  const forwarded = {};
  for (const [k, v] of Object.entries(clientHeaders)) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) forwarded[k] = v;
  }

  const response = await fetch(`${ROUTER_BASE}${path}`, {
    method: "POST",
    headers: {
      ...forwarded,
      "Content-Type": "application/json",
      ...(API_KEY && { "Authorization": `Bearer ${API_KEY}` })
    },
    body: JSON.stringify(openaiBody)
  });

  // Forward response as-is (status + body). pipeSSE will propagate status.
  return response;
}

/**
 * Pipe SSE stream from router directly to client response.
 * Optional dumper tees the stream into a debug file.
 */
function stripDoneSseEvents(text) {
  if (!text) return text;
  const normalized = text.replace(/\r\n/g, "\n");
  const events = normalized.split("\n\n");
  const trailingOpenEvent = !normalized.endsWith("\n\n") ? events.pop() : "";
  const kept = events.filter((event) => {
    if (!event.trim()) return false;
    const lines = event.split("\n").map((line) => line.trim());
    return !lines.some((line) => /^data:\s*\[DONE\]\s*$/.test(line));
  });
  const out = kept.length ? `${kept.join("\n\n")}\n\n` : "";
  return { closed: out, open: trailingOpenEvent || "" };
}

async function pipeSSE(routerRes, res, dumper, options = {}) {
  const ct = routerRes.headers.get("content-type") || "application/json";
  const status = routerRes.status || 200;
  const resHeaders = { "Content-Type": ct, "Cache-Control": "no-cache", "Connection": "keep-alive" };
  if (ct.includes("text/event-stream")) resHeaders["X-Accel-Buffering"] = "no";
  res.writeHead(status, resHeaders);
  if (dumper) dumper.writeHeader(routerRes.status, Object.fromEntries(routerRes.headers));

  if (!routerRes.body) {
    const text = await routerRes.text().catch(() => "");
    if (dumper) { dumper.writeChunk(text); dumper.end(); }
    res.end(text);
    return;
  }

  const reader = routerRes.body.getReader();
  const decoder = new TextDecoder();
  const stripDone = options.stripDone === true && ct.includes("text/event-stream");
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      const tail = pending + decoder.decode();
      if (tail) {
        if (stripDone) {
          const stripped = stripDoneSseEvents(`${tail}\n\n`).closed;
          if (stripped) {
            if (dumper) dumper.writeChunk(stripped);
            res.write(stripped);
          }
        } else {
          if (dumper) dumper.writeChunk(tail);
          res.write(tail);
        }
      }
      if (dumper) dumper.end();
      res.end();
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    if (!stripDone) {
      if (dumper) dumper.writeChunk(chunk);
      res.write(chunk);
      continue;
    }

    const stripped = stripDoneSseEvents(pending + chunk);
    pending = stripped.open;
    if (stripped.closed) {
      if (dumper) dumper.writeChunk(stripped.closed);
      res.write(stripped.closed);
    }
  }
}

module.exports = { fetchRouter, pipeSSE };
