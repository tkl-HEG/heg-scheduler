"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { asText } from "../../../lib/format";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";
import type { WorkloadStatusRow } from "../../../lib/workloadData";

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
  | { success: true; status: "created" | "updated"; allocation: { allocated_hours: number } }
  | { success: false; error: string };

type Props = {
  rows: WorkloadStatusRow[];
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

function hours(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 }).format(value);
}

function inputValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function statusFor(row: WorkloadStatusRow, allocatedHours: number | null) {
  if (row.is_pseudo_resource) return "pseudo_resource_not_counted";
  if (allocatedHours === null) return "missing_allocation";
  if (row.assigned_hours_missing > 0) return "missing_assignment_hours";

  const remaining = allocatedHours - row.assigned_hours_known;

  if (remaining < 0) return "over_allocated";
  if (remaining > 0) return "under_allocated";
  return "on_target";
}

function remainingFor(row: WorkloadStatusRow, allocatedHours: number | null) {
  if (row.is_pseudo_resource || allocatedHours === null) return null;
  return allocatedHours - row.assigned_hours_known;
}

function statusBadge(status: string, isPseudoResource: boolean) {
  if (isPseudoResource) {
    return <span className="badge badge-info">Pseudo-ressource</span>;
  }

  const badgeClass =
    status === "missing_allocation" || status === "missing_assignment_hours"
      ? "badge-warning"
      : status === "over_allocated"
        ? "badge-error"
        : "badge-info";

  return <span className={`badge ${badgeClass}`}>{status}</span>;
}

function parseHours(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999999.99) return null;

  return Math.round(parsed * 100) / 100;
}

export function AdminWorkloadClient({ rows }: Props) {
  const router = useRouter();
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse>(emptyStatus());
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [localRows, setLocalRows] = useState<WorkloadStatusRow[]>(rows);
  const [draftHours, setDraftHours] = useState<Record<string, string>>({});
  const [savingTeacherId, setSavingTeacherId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    setLocalRows(rows);
    setDraftHours({});
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

  async function saveAllocatedHours(row: WorkloadStatusRow) {
    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at redigere.");
      return;
    }

    const draftValue = draftHours[row.teacher_id] ?? inputValue(row.allocated_hours);
    const allocatedHours = parseHours(draftValue);

    if (allocatedHours === null) {
      setError("Årstimer skal være et tal mellem 0 og 999999.99.");
      return;
    }

    setSavingTeacherId(row.teacher_id);
    setNotice(null);
    setError(null);

    const previousRows = localRows;

    setLocalRows((current) =>
      current.map((currentRow) =>
        currentRow.teacher_id === row.teacher_id
          ? {
              ...currentRow,
              allocated_hours: allocatedHours,
              remaining_hours: remainingFor(currentRow, allocatedHours),
              status: statusFor(currentRow, allocatedHours)
            }
          : currentRow
      )
    );

    try {
      const response = await fetch("/api/admin/teacher-workload-allocations", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          teacher_id: row.teacher_id,
          workload_year_id: row.workload_year_id,
          allocated_hours: allocatedHours
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        setLocalRows(previousRows);
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Gem fejlede (${response.status}): ${apiError}`);
        return;
      }

      setDraftHours((current) => {
        const next = { ...current };
        delete next[row.teacher_id];
        return next;
      });
      setNotice(`Årstimer gemt for ${row.initials}.`);
      router.refresh();
    } catch (mutationError) {
      setLocalRows(previousRows);
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingTeacherId(null);
    }
  }

  return (
    <div className="admin-workload-client">
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
        {!canWrite && !loadingAuth ? <p className="notice">Årstimer er read-only for viewer og ikke-loggede brugere.</p> : null}
        {status.warning ? <p className="notice">{status.warning}</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {notice ? <p className="status-message">{notice}</p> : null}
      </section>

      <section className="content-section">
        <h2>Lærer-årstimer</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Initialer</th>
                <th>Navn</th>
                <th>Workload year</th>
                <th>Årstimer</th>
                <th>Fagfordelte timer</th>
                <th>Manglende timer</th>
                <th>Rest</th>
                <th>Status</th>
                <th>Handling</th>
              </tr>
            </thead>
            <tbody>
              {localRows.length ? (
                localRows.map((row) => {
                  const isSaving = savingTeacherId === row.teacher_id;
                  const draftValue = draftHours[row.teacher_id] ?? inputValue(row.allocated_hours);

                  return (
                    <tr key={`${row.workload_year_id}:${row.teacher_id}`}>
                      <td>
                        <strong>{asText(row.initials)}</strong>
                      </td>
                      <td>{asText(row.display_name)}</td>
                      <td>{asText(row.workload_year_label)}</td>
                      <td>
                        <input
                          className="workload-hours-input"
                          disabled={!canWrite || isSaving}
                          inputMode="decimal"
                          min="0"
                          name={`allocated_hours_${row.teacher_id}`}
                          onChange={(event) =>
                            setDraftHours((current) => ({
                              ...current,
                              [row.teacher_id]: event.target.value
                            }))
                          }
                          readOnly={!canWrite}
                          step="0.25"
                          type="number"
                          value={draftValue}
                        />
                      </td>
                      <td>{hours(row.assigned_hours_known)}</td>
                      <td>{row.assigned_hours_missing}</td>
                      <td>{row.is_pseudo_resource ? "-" : hours(row.remaining_hours)}</td>
                      <td>{statusBadge(row.status, row.is_pseudo_resource)}</td>
                      <td>
                        <button
                          className="button-secondary"
                          disabled={!canWrite || isSaving}
                          onClick={() => void saveAllocatedHours(row)}
                          type="button"
                        >
                          {isSaving ? "Gemmer..." : "Gem"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={9}>
                    Ingen rækker fundet.
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
