// No-op request logger for Workers (no filesystem)
export async function createRequestLogger(sourceFormat, targetFormat, model) {
  return {
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logTargetResponse() {},
    logProviderResponse() {},
    logTranslatedResponse() {},
    logConvertedResponse() {},
    logError() {},
  };
}