"use client";

import { useEffect } from "react";

function hasMagicLinkHash() {
  if (typeof window === "undefined") {
    return false;
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hashParams.get("type") === "magiclink" && Boolean(hashParams.get("access_token") && hashParams.get("refresh_token"));
}

export function AuthMagicLinkRedirect() {
  useEffect(() => {
    if (!hasMagicLinkHash()) {
      return;
    }

    window.location.replace(`/auth/callback?next=${encodeURIComponent("/admin/status")}${window.location.hash}`);
  }, []);

  return null;
}
