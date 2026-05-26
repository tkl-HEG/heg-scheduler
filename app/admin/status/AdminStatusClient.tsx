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

function isRateLimit(error: AuthError | null) {
  const combined = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return error?.status === 429 || combined.includes("rate limit") || combined.includes("too many");
}

function formatSendCodeError(error: AuthError | null) {
  if (isRateLimit(error)) {
    return "Der er sendt for mange login-koder. Vent 30-60 minutter og prøv igen.";
  }

  return error?.message || "Login-kode kunne ikke sendes.";
}

function formatVerifyCodeError(error: AuthError | null) {
  const combined = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();

  if (combined.includes("expired") || combined.includes("invalid") || combined.includes("otp")) {
    return "Login-koden er forkert eller udløbet. Send en ny kode og brug den nyeste kode.";
  }

  return error?.message || "Login-koden kunne ikke bekræftes.";
}

export function AdminStatusClient() {
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<StatusResponse>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [message, setMessage] = useState<string | null>(config.issue);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  async function refreshSessionAndStatus() {
    if (!supabase) return;

    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setEmail(data.session?.user.email || email);
    await loadStatus(data.session);
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setEmail(data.session?.user.email || "");
      void loadStatus(data.session);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setEmail(nextSession?.user.email || "");
      void loadStatus(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage(config.issue);
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setErrorMessage("Skriv en emailadresse.");
      return;
    }

    setSendingCode(true);
    setMessage(null);
    setErrorMessage(null);
    setToken("");

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        shouldCreateUser: false
      }
    });

    setSendingCode(false);

    if (error) {
      setErrorMessage(formatSendCodeError(error));
      return;
    }

    setCodeSent(true);
    setEmail(trimmedEmail);
    setMessage("Login-kode er sendt. Indtast koden fra mailen herunder.");
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage(config.issue);
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedToken = token.trim();

    if (!trimmedEmail) {
      setErrorMessage("Skriv en emailadresse.");
      return;
    }

    if (!trimmedToken) {
      setErrorMessage("Skriv login-koden fra mailen.");
      return;
    }

    setVerifyingCode(true);
    setMessage(null);
    setErrorMessage(null);

    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedToken,
      type: "email"
    });

    if (error) {
      setVerifyingCode(false);
      setErrorMessage(formatVerifyCodeError(error));
      return;
    }

    await refreshSessionAndStatus();
    setVerifyingCode(false);
    setCodeSent(false);
    setToken("");
    setMessage("Login lykkedes.");
  }

  async function handleLogout() {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();
    setMessage(error ? error.message : "Du er logget ud.");
    setErrorMessage(null);
    setCodeSent(false);
    setToken("");
    setSession(null);
    setStatus(emptyStatus());
  }

  return (
    <div className="admin-status-stack">
      <section className="info-box">
        Kompetence-redigering er kun aktiv for brugere med owner/admin/editor rolle. Denne side viser loginstatus og
        rollegrundlag.
      </section>

      <section className="content-section">
        <h2>Login med kode</h2>
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
          <>
            <form className="filter-bar admin-login-form" onSubmit={handleSendCode}>
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
              <button disabled={sendingCode} type="submit">
                {sendingCode ? "Sender..." : "Send login-kode"}
              </button>
            </form>

            {codeSent ? (
              <form className="filter-bar admin-login-form" onSubmit={handleVerifyCode}>
                <label>
                  Kode
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    name="token"
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="6-cifret kode"
                    type="text"
                    value={token}
                  />
                </label>
                <button disabled={verifyingCode} type="submit">
                  {verifyingCode ? "Bekræfter..." : "Bekræft kode"}
                </button>
              </form>
            ) : null}
          </>
        )}
        {message ? <p className="status-message">{message}</p> : null}
        {errorMessage ? <p className="notice">{errorMessage}</p> : null}
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
