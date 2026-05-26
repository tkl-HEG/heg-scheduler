"use client";

import type { Session } from "@supabase/supabase-js";
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

export function AdminStatusClient() {
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<StatusResponse>(emptyStatus());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(config.issue);

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

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setEmail(data.session?.user.email || "");
      void loadStatus(data.session);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/admin/status`
      }
    });

    setMessage(error ? error.message : "Login-link er sendt, hvis emailen kan bruges.");
  }

  async function handleLogout() {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();
    setMessage(error ? error.message : "Du er logget ud.");
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
