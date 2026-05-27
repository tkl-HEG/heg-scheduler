"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { asText } from "../../../lib/format";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";
import type {
  AdminCourseSubjectRow,
  AdminCourseSubjectsSchemaInfo,
  AdminSchoolRow
} from "../../../lib/adminCourseSubjectsData";

type AdminStatusResponse = {
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

type ApiSubject = {
  id: string;
  school_id: string;
  name: string;
  normalized_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ApiResult =
  | { success: true; status: "created" | "updated" | "unchanged"; subject: ApiSubject }
  | { success: false; error: string };

type SubjectDraft = {
  name: string;
  normalized_key: string;
};

type CreateDraft = SubjectDraft & {
  school_id: string;
};

type Props = {
  subjects: AdminCourseSubjectRow[];
  schools: AdminSchoolRow[];
  schema: AdminCourseSubjectsSchemaInfo;
};

function emptyStatus(): AdminStatusResponse {
  return {
    success: true,
    loggedIn: false,
    user: null,
    organization: null,
    membership: null,
    hasWriteAccess: false
  };
}

function subjectDraft(subject: AdminCourseSubjectRow): SubjectDraft {
  return {
    name: subject.name,
    normalized_key: subject.normalized_key || ""
  };
}

function normalizedDraftValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function hasDraftChanges(subject: AdminCourseSubjectRow, draft: SubjectDraft) {
  return subject.name !== draft.name.trim() || (subject.normalized_key || "") !== (normalizedDraftValue(draft.normalized_key) || "");
}

function sortSubjects(subjects: AdminCourseSubjectRow[]) {
  return [...subjects].sort((a, b) => a.name.localeCompare(b.name, "da") || a.school_name.localeCompare(b.school_name, "da"));
}

function mapApiSubject(
  subject: ApiSubject,
  schools: AdminSchoolRow[],
  existing?: AdminCourseSubjectRow
): AdminCourseSubjectRow {
  const school = schools.find((candidate) => candidate.id === subject.school_id);

  return {
    id: subject.id,
    school_id: subject.school_id,
    school_name: school?.name || school?.slug || existing?.school_name || "-",
    name: subject.name,
    normalized_key: subject.normalized_key ?? null,
    metadata: subject.metadata || {},
    created_at: subject.created_at,
    updated_at: subject.updated_at,
    competency_count: existing?.competency_count || 0,
    offering_count: existing?.offering_count || 0,
    requirement_count: existing?.requirement_count || 0,
    status_label: existing?.status_label || "Ingen statusfelt"
  };
}

function initialCreateDraft(schools: AdminSchoolRow[]): CreateDraft {
  return {
    school_id: schools[0]?.id || "",
    name: "",
    normalized_key: ""
  };
}

export function AdminCourseSubjectsClient({ subjects, schools, schema }: Props) {
  const router = useRouter();
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse>(emptyStatus());
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [localSubjects, setLocalSubjects] = useState<AdminCourseSubjectRow[]>(subjects);
  const [drafts, setDrafts] = useState<Record<string, SubjectDraft>>({});
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => initialCreateDraft(schools));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    setLocalSubjects(subjects);
    setDrafts({});
    setLastSavedId(null);
  }, [subjects]);

  useEffect(() => {
    setCreateDraft((current) => ({
      ...current,
      school_id: current.school_id || schools[0]?.id || ""
    }));
  }, [schools]);

  useEffect(() => {
    if (!supabase) {
      setLoadingAuth(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void loadStatus(data.session);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      void loadStatus(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function loadStatus(nextSession: Session | null) {
    if (!nextSession) {
      setStatus(emptyStatus());
      setLoadingAuth(false);
      return;
    }

    setLoadingAuth(true);

    try {
      const response = await fetch("/api/admin/status", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${nextSession.access_token}`
        }
      });

      const body = (await response.json()) as AdminStatusResponse;

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
    } catch (fetchError) {
      setStatus({
        ...emptyStatus(),
        success: false,
        loggedIn: true,
        user: {
          id: nextSession.user.id,
          email: nextSession.user.email || null
        },
        error: fetchError instanceof Error ? fetchError.message : String(fetchError)
      });
    } finally {
      setLoadingAuth(false);
    }
  }

  const canWrite = Boolean(session && status.hasWriteAccess);
  const createReady = Boolean(createDraft.school_id && createDraft.name.trim());
  const lifecycleMessage =
    "course_subjects har ikke is_active, status eller archived_at. Tilføj et lifecycle-felt før deaktivering aktiveres.";

  const schoolOptions = useMemo(
    () =>
      schools.map((school) => ({
        id: school.id,
        label: school.slug ? `${school.name} (${school.slug})` : school.name
      })),
    [schools]
  );

  function updateDraft(subject: AdminCourseSubjectRow, patch: Partial<SubjectDraft>) {
    setDrafts((current) => ({
      ...current,
      [subject.id]: {
        ...subjectDraft(subject),
        ...current[subject.id],
        ...patch
      }
    }));
  }

  async function createSubject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at oprette fag.");
      return;
    }

    if (!createReady) {
      setError("Fagnavn og skole skal udfyldes.");
      return;
    }

    setSavingKey("create");
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/course-subjects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "create",
          school_id: createDraft.school_id,
          name: createDraft.name.trim(),
          normalized_key: normalizedDraftValue(createDraft.normalized_key)
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Opret fejlede (${response.status}): ${apiError}`);
        return;
      }

      const created = mapApiSubject(body.subject, schools);
      setLocalSubjects((current) => sortSubjects([...current, created]));
      setCreateDraft(initialCreateDraft(schools));
      setNotice(`Faget ${created.name} blev oprettet.`);
      setLastSavedId(created.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveSubject(subject: AdminCourseSubjectRow) {
    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at redigere fag.");
      return;
    }

    const draft = drafts[subject.id] || subjectDraft(subject);
    const name = draft.name.trim();

    if (!name) {
      setError("Fagnavn skal udfyldes.");
      return;
    }

    setSavingKey(`update:${subject.id}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/course-subjects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "update",
          id: subject.id,
          name,
          normalized_key: normalizedDraftValue(draft.normalized_key)
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Gem fejlede (${response.status}): ${apiError}`);
        return;
      }

      const updated = mapApiSubject(body.subject, schools, subject);
      setLocalSubjects((current) => sortSubjects(current.map((candidate) => (candidate.id === subject.id ? updated : candidate))));
      setDrafts((current) => {
        const next = { ...current };
        delete next[subject.id];
        return next;
      });
      setNotice(body.status === "unchanged" ? `${updated.name} var allerede opdateret.` : `${updated.name} blev gemt.`);
      setLastSavedId(subject.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="admin-subject-client">
      <section className="content-section">
        <h2>Adgang</h2>
        {loadingAuth ? <p className="status-message">Henter loginstatus...</p> : null}
        {!session ? (
          <p className="notice">
            Log ind som owner/admin/editor for at redigere. Brug <Link href="/admin/status">Admin status</Link> til login.
          </p>
        ) : null}
        {session ? (
          <p className="status-message">
            Logget ind som <strong>{asText(session.user.email)}</strong>. Write-adgang:{" "}
            <strong>{status.hasWriteAccess ? "Ja" : "Nej"}</strong>.
          </p>
        ) : null}
        {!canWrite && !loadingAuth ? <p className="notice">Fag er read-only for viewer og ikke-loggede brugere.</p> : null}
        {!schema.supports_deactivation ? <p className="notice">{lifecycleMessage}</p> : null}
        {status.warning ? <p className="notice">{status.warning}</p> : null}
        {status.error ? <p className="notice">{status.error}</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {notice ? <p className="status-message">{notice}</p> : null}
      </section>

      <section className="content-section">
        <h2>Opret fag</h2>
        <form className="admin-subject-form" onSubmit={(event) => void createSubject(event)}>
          <label>
            Skole
            <select
              disabled={!canWrite || savingKey === "create" || schoolOptions.length <= 1}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  school_id: event.target.value
                }))
              }
              value={createDraft.school_id}
            >
              {schoolOptions.length ? (
                schoolOptions.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.label}
                  </option>
                ))
              ) : (
                <option value="">Ingen skole fundet</option>
              )}
            </select>
          </label>
          <label>
            Navn
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              placeholder="Fagnavn"
              readOnly={!canWrite}
              type="text"
              value={createDraft.name}
            />
          </label>
          <label>
            Nøgle
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  normalized_key: event.target.value
                }))
              }
              placeholder="Valgfri normalized_key"
              readOnly={!canWrite}
              type="text"
              value={createDraft.normalized_key}
            />
          </label>
          <button disabled={!canWrite || !createReady || savingKey === "create"} type="submit">
            {savingKey === "create" ? "Opretter..." : "Opret fag"}
          </button>
        </form>
      </section>

      <section className="content-section">
        <h2>Fag</h2>
        <div className="table-wrap">
          <table className="admin-subject-table">
            <thead>
              <tr>
                <th>Navn</th>
                <th>Nøgle</th>
                <th>Skole</th>
                <th>Kompetencer</th>
                <th>Fagudbud</th>
                <th>Fagkrav</th>
                <th>Status</th>
                <th>Handling</th>
              </tr>
            </thead>
            <tbody>
              {localSubjects.length ? (
                localSubjects.map((subject) => {
                  const draft = drafts[subject.id] || subjectDraft(subject);
                  const isSaving = savingKey === `update:${subject.id}`;
                  const isDirty = hasDraftChanges(subject, draft);
                  const canEdit = canWrite && !isSaving;

                  return (
                    <tr key={subject.id}>
                      <td>
                        <input
                          className="subject-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(subject, { name: event.target.value })}
                          readOnly={!canEdit}
                          type="text"
                          value={draft.name}
                        />
                      </td>
                      <td>
                        <input
                          className="subject-field-input subject-key-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(subject, { normalized_key: event.target.value })}
                          readOnly={!canEdit}
                          type="text"
                          value={draft.normalized_key}
                        />
                      </td>
                      <td>{asText(subject.school_name)}</td>
                      <td>{subject.competency_count}</td>
                      <td>{subject.offering_count}</td>
                      <td>{subject.requirement_count}</td>
                      <td>
                        <span className="badge badge-warning">{subject.status_label}</span>
                        <small>{schema.supports_deactivation ? "Kan deaktiveres" : "Deaktivering kræver migration"}</small>
                      </td>
                      <td>
                        <div className="subject-actions">
                          <button
                            className="button-secondary"
                            disabled={!canWrite || !isDirty || isSaving}
                            onClick={() => void saveSubject(subject)}
                            type="button"
                          >
                            {isSaving ? "Gemmer..." : "Gem"}
                          </button>
                          <button className="button-secondary" disabled title={lifecycleMessage} type="button">
                            Deaktivér
                          </button>
                          {lastSavedId === subject.id && !isSaving ? <small>Sidst gemt</small> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={8}>
                    Ingen fag fundet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
