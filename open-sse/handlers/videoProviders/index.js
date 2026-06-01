// Video provider adapter registry
import runwayml from "./runwayml.js";
import xai from "./xai.js";

const ADAPTERS = {
  runwayml,
  xai,
};

export function getVideoAdapter(provider) {
  return ADAPTERS[provider] || null;
}

export function isVideoProvider(provider) {
  return provider in ADAPTERS;
}
