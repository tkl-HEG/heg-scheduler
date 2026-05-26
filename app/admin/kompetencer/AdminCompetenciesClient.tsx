"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { DataTable } from "../../../components/DataTable";
import { asText } from "../../../lib/format";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";
import type {
  AdminCompetencyMatrixRow,
  AdminSubjectRow
} from "../../../lib/adminCompetenciesData";

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

type ApiResult =
  | { success: true; status: "created" | "removed" | "exists"; competency?: Record<string, unknown> }
  | { success: false; error: string };

type Props = {
  rows: AdminCompetencyMatrixRow[];
  subjects: AdminSubjectRow[];
};

type CellState = AdminCompetencyMatrixRow["subject_states"][number];

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

function teacherLabel(row: AdminCompetencyMatrixRow) {
  return row.teacher.display_name ? `${row.teacher.initials} - ${row.teacher.display_name}` : row.teacher.initials;
}

function summarizeCellState(state: CellState | undefined) {
  return state?.has_competency ? state.level || "primary" : null;
}

export function AdminCompetenciesClient({ rows, subjects }: Props) {
  const router = useRouter();
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse>(emptyStatus());
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState<AdminCompetencyMatrixRow[]>(rows);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

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

  function applyOptimisticChange(teacherId: string, subjectId: string, action: "add" | "remove") {
    setLocalRows((current) =>
      current.map((row) => {
        if (row.teacher.id !== teacherId) return row;

        return {
          ...row,
          subject_states: row.subject_states.map((state) => {
            if (state.subject_id !== subjectId) return state;

            if (action === "add") {
              return {
                ...state,
                has_competency: true,
                level: state.level || "primary"
              };
            }

            return {
              ...state,
              has_competency: false,
              level: null
            };
          })
        };
      })
    );
  }

  async function handleToggle(row: AdminCompetencyMatrixRow, subject: AdminSubjectRow) {
    if (!supabase || !session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at redigere.");
      return;
    }

    const currentState = row.subject_states.find((state) => state.subject_id === subject.id);
    const isChecked = Boolean(currentState?.has_competency);
    const level = summarizeCellState(currentState) || "primary";
    const action = isChecked ? "remove" : "add";
    const key = `${row.teacher.id}:${subject.id}:${level}`;

    setSavingKey(key);
    setNotice(null);
    setError(null);

    const snapshot = localRows;
    applyOptimisticChange(row.teacher.id, subject.id, action);

    try {
      const response = await fetch("/api/admin/teacher-competencies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action,
          teacher_id: row.teacher.id,
          course_subject_id: subject.id,
          level
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        setLocalRows(snapshot);
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Gem fejlede (${response.status}): ${apiError}`);
        return;
      }

      setNotice(
        action === "add"
          ? `Kompetence tilføjet for ${row.teacher.initials} / ${subject.name}.`
          : `Kompetence fjernet for ${row.teacher.initials} / ${subject.name}.`
      );
      router.refresh();
    } catch (mutationError) {
      setLocalRows(snapshot);
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  const teacherRows = localRows.map((row) => [
    <strong key="initials">{asText(row.teacher.initials)}</strong>,
    asText(row.teacher.display_name),
    row.subject_states.filter((state) => state.has_competency).length,
    row.teacher.is_pseudo_resource ? "Ja" : "Nej"
  ]);

  const subjectRows = subjects.map((subject) => [
    asText(subject.name),
    asText(subject.normalized_key),
    localRows.reduce((sum, row) => {
      const state = row.subject_states.find((subjectState) => subjectState.subject_id === subject.id);
      return sum + (state?.has_competency ? 1 : 0);
    }, 0)
  ]);

  const competencyRows = localRows.flatMap((row) =>
    row.subject_states
      .filter((state) => state.has_competency)
      .map((state) => [
        asText(row.teacher.display_name ? `${row.teacher.initials} - ${row.teacher.display_name}` : row.teacher.initials),
        asText(state.subject_name),
        <span className="badge badge-info" key={`${row.teacher.id}:${state.subject_id}:level`}>
          {asText(state.level || "primary")}
        </span>,
        <label className="checkbox-preview" key={`${row.teacher.id}:${state.subject_id}:edit`}>
          <input checked disabled readOnly type="checkbox" />
          <span>Kommer senere</span>
        </label>
      ])
  );

  return (
    <div className="admin-competencies-client">
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
        {status.warning ? <p className="notice">{status.warning}</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {notice ? <p className="status-message">{notice}</p> : null}
      </section>

      <section className="content-section">
        <h2>Kompetencematrix</h2>
        <div className="table-wrap competency-table-wrap">
          <table className="competency-matrix">
            <thead>
              <tr>
                <th className="competency-sticky" scope="col">
                  Lærer
                </th>
                {subjects.map((subject) => (
                  <th className="competency-subject" key={subject.id} scope="col" title={subject.name}>
                    {subject.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {localRows.length && subjects.length ? (
                localRows.map((row) => {
                  const statesBySubject = new Map(row.subject_states.map((state) => [state.subject_id, state]));

                  return (
                    <tr key={row.teacher.id}>
                      <th className="competency-sticky competency-teacher-cell" scope="row">
                        <strong>{asText(row.teacher.initials)}</strong>
                        <small>{asText(row.teacher.display_name, "")}</small>
                      </th>
                      {subjects.map((subject) => {
                        const state = statesBySubject.get(subject.id);
                        const checked = Boolean(state?.has_competency);
                        const isSaving = savingKey === `${row.teacher.id}:${subject.id}:${summarizeCellState(state) || "primary"}`;

                        return (
                          <td className={`competency-cell${checked ? "" : " matrix-muted-cell"}`} key={subject.id}>
                            <label className="checkbox-preview" title={state?.subject_name || subject.name}>
                              <input
                                checked={checked}
                                disabled={!canWrite || isSaving}
                                onChange={() => void handleToggle(row, subject)}
                                readOnly={!canWrite}
                                type="checkbox"
                              />
                              <span>{isSaving ? "Gemmer..." : state?.level || "-"}</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={Math.max(subjects.length + 1, 1)}>
                    Ingen rækker fundet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <h2>Lærere</h2>
        <DataTable
          columns={["Initialer", "Navn", "Kompetencer i visning", "Pseudo-resource"]}
          rows={teacherRows}
        />
      </section>

      <section className="content-section">
        <h2>Fag</h2>
        <DataTable columns={["Fag", "Nøgle", "Kompetencer i visning"]} rows={subjectRows} />
      </section>

      <section className="content-section">
        <h2>Eksisterende kompetencer</h2>
        <DataTable
          columns={["Lærer", "Fag", "Niveau", "Redigering"]}
          rows={competencyRows}
          emptyText="Ingen kompetencer i den filtrerede visning."
        />
      </section>
    </div>
  );
}
