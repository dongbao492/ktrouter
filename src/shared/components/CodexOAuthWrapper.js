"use client";

import { useState, useCallback } from "react";
import PropTypes from "prop-types";
import CodexAuthModal from "./CodexAuthModal";
import OAuthModal from "./OAuthModal";

export default function CodexOAuthWrapper({ isOpen, providerInfo, onSuccess, onClose }) {
  const [authMethod, setAuthMethod] = useState(null);

  const handleMethodSelect = useCallback((method) => {
    if (method === "browser") setAuthMethod("browser");
  }, []);

  const handleImportSuccess = useCallback(() => {
    onSuccess?.();
  }, [onSuccess]);

  const handleBack = () => {
    setAuthMethod(null);
  };

  if (!authMethod) {
    return (
      <CodexAuthModal
        isOpen={isOpen}
        onMethodSelect={handleMethodSelect}
        onImportSuccess={handleImportSuccess}
        onClose={onClose}
      />
    );
  }

  if (authMethod === "browser") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="codex"
        providerInfo={providerInfo}
        onSuccess={() => {
          setAuthMethod(null);
          onSuccess?.();
          onClose?.();
        }}
        onClose={handleBack}
      />
    );
  }

  return null;
}

CodexOAuthWrapper.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({
    name: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
