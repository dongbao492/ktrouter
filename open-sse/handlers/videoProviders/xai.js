import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "../imageProviders/_base.js";

const BASE_URL = "https://api.x.ai/v1";

export default {
  async: true,
  buildUrl: (model) => {
    return `${BASE_URL}/videos/generations`;
  },
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    };
  },
  buildBody: (model, body) => {
    const req = {
      model: model || "grok-imagine-video",
      prompt: body.prompt,
    };
    
    if (body.aspect_ratio) {
      req.aspect_ratio = body.aspect_ratio;
    }
    
    const duration = body.duration || body.seconds;
    if (duration) {
      req.duration = Number(duration);
    }

    if (body.image) {
      if (typeof body.image === "object") {
        req.image = body.image;
      } else if (typeof body.image === "string" && body.image.trim() !== "") {
        req.image = { url: body.image.trim() };
      }
    }
    
    return req;
  },
  async parseResponse(response, { headers }) {
    const resJson = await response.json();
    const id = resJson.request_id || resJson.id;
    if (!id) {
      throw new Error(resJson.error?.message || "xAI: no task id returned");
    }
    
    const taskUrl = `${BASE_URL}/videos/${id}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(taskUrl, { headers });
      if (!r.ok) {
        const errorJson = await r.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || `xAI status ${r.status}`);
      }
      
      const s = await r.json();
      if (s.status === "done") {
        return s;
      }
      if (s.status === "failed" || s.status === "cancelled") {
        throw new Error(s.error?.message || "xAI video task failed or cancelled");
      }
    }
    throw new Error("xAI video polling timeout");
  },
  normalize: (responseBody) => {
    const videoUrl = responseBody.video?.url || responseBody.video || "";
    return {
      created: nowSec(),
      data: [{ url: videoUrl }]
    };
  },
};
