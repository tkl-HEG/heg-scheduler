"use client";

import type { AuthError, Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useState } from "react";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";

type StatusResponse = {
  success: boolean;
  loggedIn: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  organization: {
    id: string;
    slug: string;
    name: string;
  } | null;
  membership: {
    organization_id: string;
    user_id: string | null;
    email: string;
    role: "owner" | "admin" | "editor" | "viewer";
    is_active: boolean;
  } | null;
  hasWriteAccess: boolean;
  warning?: string;
  error?: string;
};

type AuthCallbackInfo = {
  code: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  hasCallbackData: boolean;
};

function emptyStatus(): StatusResponse {
  return {
    success: true,
    loggedIn: false,
    user: null,
    organization: null,
    membership: null,
    hasWriteAccess: false
  };
}

function asText(value: string | null | undefined) {
  return value || "-";
}

function readAuthCallbackInfo(): AuthCallbackInfo | null {
  if (typeof window === "undefined") {
    return null;
  }

  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  const code = searchParams.get("code");
  const error = searchParams.get("error") || hashParams.get("error");
  const errorCode = searchParams.get("error_code") || hashParams.get("error_code");
  const errorDescription = searchParams.get("error_description") || hashParams.get("error_description");
  const accessToken = hashParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token");

  return {
    code,
    error,
    errorCode,
    errorDescription,
    accessToken,
    refreshToken,
    hasCallbackData: Boolean(code || error || errorCode || errorDescription || (accessToken && refreshToken))
  };
}

function clearAuthCallbackUrl() {
  if (typeof window === "undefined") {
    return;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
}

function formatRateLimitedLoginError(error: AuthError | null) {
  if (!error) {
    return "Login-link kunne ikke sendes.";
  }

  const combined = `${error.code || ""} ${error.message || ""}`.toLowerCase();

  if (error.status === 429 || combined.includes("rate limit")) {
    return "Der er sendt for mange login-links. Vent 30-60 minutter og prøv igen.";
  }

  return error.message || "Login-link kunne ikke sendes.";
}

function formatCallbackError(info: AuthCallbackInfo) {
  if (info.errorCode === "otp_expired") {
    return "Login-linket er udløbet eller allerede brugt. Send et nyt login-link og brug kun det nyeste link.";
  }

  const parts = [info.errorCode, info.error, info.errorDescription].filter(Boolean);

  if (parts.length) {
    return `Login fejlede: ${parts.join(" / ")}`;
  }

  return "Login fejlede: Ukendt fejl.";
}

function formatExchangeError(error: AuthError | null) {
  if (!error) {
    return "Login fejlede: Session kunne ikke oprettes.";
  }

  return `Login fejlede: ${error.message || "Session kunne ikke oprettes."}`;
}

export function AdminStatusClient() {
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<StatusResponse>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(config.issue);
  const [callbackMessage, setCallbackMessage] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);

  async function loadStatus(nextSession: Session | null) {
    if (!nextSession) {
      setStatus(emptyStatus());
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/admin/status", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${nextSession.access_token}`
        }
      });

      const body = (await response.json()) as StatusResponse;

      if (!response.ok) {
        setStatus({
          ...emptyStatus(),
          success: false,
          loggedIn: true,
          user: {
            id: nextSession.user.id,
            email: nextSession.user.email || null
          },
          error: body.error || "Status kunne ikke hentes."
        });
      } else {
        setStatus(body);
      }
    } catch (error) {
      setStatus({
        ...emptyStatus(),
        success: false,
        loggedIn: true,
        user: {
          id: nextSession.user.id,
          email: nextSession.user.email || null
        },
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const refreshSessionAndStatus = async () => {
      const { data } = await supabase.auth.getSession();

      if (!mounted) {
        return null;
      }

      setSession(data.session);
      setEmail(data.session?.user.email || "");
      await loadStatus(data.session);

      return data.session;
    };

    const processAuthCallback = async () => {
      const callback = readAuthCallbackInfo();

      if (!callback?.hasCallbackData) {
        await refreshSessionAndStatus();
        return;
      }

      setLoading(true);
      setCallbackError(callback.error || callback.errorCode || callback.errorDescription ? formatCallbackError(callback) : null);
      setCallbackMessage("Login-link behandles...");

      let exchangeError: AuthError | null = null;

      if (callback.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(callback.code);
        exchangeError = error;
      } else if (callback.accessToken && callback.refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken
        });
        exchangeError = error;
      }

      clearAuthCallbackUrl();

      if (exchangeError) {
        const errorMessage = formatExchangeError(exchangeError);
        setCallbackError(errorMessage);
        setCallbackMessage(null);
      }

      const latestSession = await refreshSessionAndStatus();

      if (latestSession) {
        setCallbackMessage("Login lykkedes");
        setCallbackError(null);
      } else if (!exchangeError && !callback.error && !callback.errorCode && !callback.errorDescription) {
        setCallbackError("Login fejlede: Session kunne ikke oprettes.");
        setCallbackMessage(null);
      }
    };

    void processAuthCallback();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) {
        return;
      }

      setSession(nextSession);
      setEmail(nextSession?.user.email || "");
      void loadStatus(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setMessage(config.issue);
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setMessage("Skriv en emailadresse.");
      return;
    }

    setMessage(null);
    setCallbackMessage(null);
    setCallbackError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: window.location.origin + "/admin/status"
      }
    });

    setMessage(error ? formatRateLimitedLoginError(error) : "Login-link er sendt, hvis emailen kan bruges.");
  }

  async function handleLogout() {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();
    setMessage(error ? error.message : "Du er logget ud.");
    setCallbackMessage(null);
    setCallbackError(null);
    setSession(null);
    setStatus(emptyStatus());
  }

  return (
    <div className="admin-status-stack">
      <section className="info-box">
        Kompetence-redigering er stadig ikke aktiveret i UI. Denne side viser kun loginstatus og rollegrundlag.
      </section>

      <section className="content-section">
        <h2>Login</h2>
        {session ? (
          <div className="status-actions">
            <span>
              Logget ind som <strong>{asText(session.user.email)}</strong>
            </span>
            <button className="button-secondary" onClick={handleLogout} type="button">
              Log ud
            </button>
          </div>
        ) : (
          <form className="filter-bar admin-login-form" onSubmit={handleLogin}>
            <label>
              Email
              <input
                autoComplete="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="navn@heguddannelser.dk"
                type="email"
                value={email}
              />
            </label>
            <button type="submit">Send login-link</button>
          </form>
        )}
        {callbackMessage ? <p className="status-message">{callbackMessage}</p> : null}
        {callbackError ? <p className="notice">{callbackError}</p> : null}
        {message ? <p className="status-message">{message}</p> : null}
      </section>

      <section className="content-section">
        <h2>Admin status</h2>
        {loading ? <p className="status-message">Henter status...</p> : null}
        {status.error ? <p className="notice">{status.error}</p> : null}
        {status.warning ? <p className="notice">{status.warning}</p> : null}

        <dl className="definition-grid">
          <div>
            <dt>Logget ind</dt>
            <dd>{status.loggedIn ? "Ja" : "Nej"}</dd>
          </div>
          <div>
            <dt>Auth user id</dt>
            <dd>{asText(status.user?.id)}</dd>
          </div>
          <div>
            <dt>Auth email</dt>
            <dd>{asText(status.user?.email)}</dd>
          </div>
          <div>
            <dt>Organisation</dt>
            <dd>{status.organization ? `${status.organization.name} (${status.organization.slug})` : "-"}</dd>
          </div>
          <div>
            <dt>Rolle</dt>
            <dd>{asText(status.membership?.role)}</dd>
          </div>
          <div>
            <dt>Write-adgang</dt>
            <dd>{status.hasWriteAccess ? "Ja" : "Nej"}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
