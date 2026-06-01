const { err, createResponseDumper } = require("../logger");
const { fetchRouter, pipeSSE } = require("./base");

/**
 * Intercept Antigravity request — forward Gemini body as-is to /v1/chat/completions.
 * Router auto-detects format via body.userAgent==="antigravity" + body.request.contents,
 * runs antigravity→openai→provider→openai→antigravity translators internally.
 */
async function intercept(req, res, bodyBuffer, mappedModel, passthrough) {
  const dumper = createResponseDumper(req, "intercept-antigravity");
  const isStream = req.url.includes(":streamGenerateContent");
  try {
    const body = JSON.parse(bodyBuffer.toString());

    // Extract model from URL if not in body (Antigravity puts model in URL path)
    if (!body.model) {
      const urlMatch = req.url.match(/\/models\/([^\/:]+)/);
      if (urlMatch) body.model = urlMatch[1];
    }

    // Antigravity 2.0 surfaces router/provider 401s as "you are logged out".
    // If the user has not mapped this exact model, let the native request go to
    // Google instead of sending an unmapped model to KTRouter.
    if (!mappedModel) {
      if (dumper) dumper.end();
      if (typeof passthrough === "function") {
        return passthrough(req, res, bodyBuffer);
      }
      throw new Error("No Antigravity model mapping found");
    }

    body.model = mappedModel;

    const routerPath = (body.input && !body.messages) ? "/v1/responses" : "/v1/chat/completions";
    const routerRes = await fetchRouter(body, routerPath, req.headers);
    // Native Antigravity streams close without the OpenAI `[DONE]` sentinel.
    // The IDE client is stricter than the agent binary and can surface a parse
    // failure as a misleading auth/logout error.
    await pipeSSE(routerRes, res, dumper, { stripDone: true });
  } catch (error) {
    err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (isStream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
    }
  }
}

module.exports = { intercept };
