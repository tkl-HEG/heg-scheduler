"use client";

import type { AuthError } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";

type CallbackInfo = {
  code: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  next: string;
};

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/admin/status";
  }

  return value;
}

function readCallbackInfo(): CallbackInfo {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error") || hashParams.get("error"),
    errorCode: url.searchParams.get("error_code") || hashParams.get("error_code"),
    errorDescription: url.searchParams.get("error_description") || hashParams.get("error_description"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    next: safeNext(url.searchParams.get("next"))
  };
}

function clearCallbackUrl() {
  window.history.replaceState({}, document.title, "/auth/callback");
}

function callbackErrorMessage(info: CallbackInfo) {
  if (info.errorCode === "otp_expired") {
    return "Login-linket er udløbet eller allerede brugt. Send et nyt login-link og brug kun det nyeste link.";
  }

  const details = [info.errorCode, info.error, info.errorDescription].filter(Boolean);
  return details.length ? `Login fejlede: ${details.join(" / ")}` : "Login fejlede: Ukendt fejl.";
}

function exchangeErrorMessage(error: AuthError | null) {
  return `Login fejlede: ${error?.message || "Session kunne ikke oprettes."}`;
}

export function AuthCallbackClient() {
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [message, setMessage] = useState("Behandler login-link...");
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    if (!supabase || config.issue) {
      setMessage("Login fejlede");
      setError(config.issue);
      return;
    }

    let cancelled = false;

    async function handleCallback() {
      const callback = readCallbackInfo();

      if (callback.error || callback.errorCode || callback.errorDescription) {
        clearCallbackUrl();
        setMessage("Login fejlede");
        setError(callbackErrorMessage(callback));
        return;
      }

      let callbackExchangeError: AuthError | null = null;

      if (callback.code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(callback.code);
        callbackExchangeError = exchangeError;
      } else if (callback.accessToken && callback.refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken
        });
        callbackExchangeError = sessionError;
      } else {
        callbackExchangeError = {
          name: "AuthCallbackMissingData",
          message: "Login-linket indeholdt hverken code eller session-tokens."
        } as AuthError;
      }

      clearCallbackUrl();

      if (cancelled) {
        return;
      }

      if (callbackExchangeError) {
        setMessage("Login fejlede");
        setError(exchangeErrorMessage(callbackExchangeError));
        return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !data.session) {
        setMessage("Login fejlede");
        setError(exchangeErrorMessage(sessionError));
        return;
      }

      setMessage("Login lykkedes, videresender...");
      setError(null);
      window.location.replace(callback.next);
    }

    void handleCallback();

    return () => {
      cancelled = true;
    };
  }, [config.issue, supabase]);

  return (
    <section className="content-section">
      <h2>Login</h2>
      <p className={error ? "notice" : "status-message"}>{error || message}</p>
      {error ? (
        <p>
          <Link href="/admin/status">Tilbage til Admin status</Link>
        </p>
      ) : null}
    </section>
  );
}
