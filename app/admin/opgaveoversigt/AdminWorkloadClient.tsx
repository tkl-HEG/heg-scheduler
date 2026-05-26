"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { asText } from "../../../lib/format";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";
import type { WorkloadDebugInfo, WorkloadStatusRow } from "../../../lib/workloadData";

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
  | {
      success: false;
      error: string;
      debug?: {
        received?: {
          teacher_id?: unknown;
          workload_year_id?: unknown;
          allocated_hours?: unknown;
        };
      };
    };

type Props = {
  rows: WorkloadStatusRow[];
  debug?: WorkloadDebugInfo;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const remaining = allocatedHours - row.assigned_hours_known - row.assigned_hours_missing;

  if (remaining < 0) return "over_allocated";
  if (remaining > 0) return "under_allocated";
  return "on_target";
}

function remainingFor(row: WorkloadStatusRow, allocatedHours: number | null) {
  if (row.is_pseudo_resource || allocatedHours === null) return null;
  return allocatedHours - row.assigned_hours_known - row.assigned_hours_missing;
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

function normalizeUuid(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function rowIdentityIssue(row: WorkloadStatusRow) {
  if (!normalizeUuid(row.teacher_id) || !normalizeUuid(row.workload_year_id)) return "Kan ikke gemmes: mangler UUID";
  return null;
}

function rowKey(row: WorkloadStatusRow) {
  return `${row.workload_year_id || "missing-year"}:${row.teacher_id || row.initials || row.display_name || "missing-teacher"}`;
}

function saveDebugText(input: {
  initials: string;
  teacher_id: string | null;
  workload_year_id: string | null;
  allocated_hours: number | null;
}) {
  return `Debug: initials=${input.initials || "-"}, teacher_id=${input.teacher_id || "-"}, workload_year_id=${
    input.workload_year_id || "-"
  }, allocated_hours=${input.allocated_hours ?? "-"}`;
}

export function AdminWorkloadClient({ rows, debug }: Props) {
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse>(emptyStatus());
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [localRows, setLocalRows] = useState<WorkloadStatusRow[]>(rows);
  const [draftHours, setDraftHours] = useState<Record<string, string>>({});
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [lastSavedRowKey, setLastSavedRowKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    setLocalRows(rows);
    setDraftHours({});
    setRowErrors({});
    setLastSavedRowKey(null);
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
    const key = rowKey(row);

    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at redigere.");
      return;
    }

    const draftValue = draftHours[key] ?? inputValue(row.allocated_hours);
    const allocatedHours = parseHours(draftValue);
    const teacherId = normalizeUuid(row.teacher_id);
    const workloadYearId = normalizeUuid(row.workload_year_id);
    const identityIssue = !teacherId || !workloadYearId ? "Kan ikke gemmes: mangler UUID" : null;

    if (identityIssue) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Workload row cannot be saved without UUIDs", {
          initials: row.initials,
          teacher_id: row.teacher_id,
          workload_year_id: row.workload_year_id
        });
      }
      setNotice(null);
      setError(identityIssue);
      setRowErrors((current) => ({
        ...current,
        [key]: `${identityIssue}. ${saveDebugText({
          initials: row.initials,
          teacher_id: teacherId,
          workload_year_id: workloadYearId,
          allocated_hours: allocatedHours
        })}`
      }));
      return;
    }

    if (allocatedHours === null) {
      setNotice(null);
      setError("Årstimer skal være et tal mellem 0 og 999999.99.");
      setRowErrors((current) => ({
        ...current,
        [key]: `Årstimer skal være et gyldigt tal. ${saveDebugText({
          initials: row.initials,
          teacher_id: teacherId,
          workload_year_id: workloadYearId,
          allocated_hours: allocatedHours
        })}`
      }));
      return;
    }

    const payload = {
      teacher_id: teacherId,
      workload_year_id: workloadYearId,
      allocated_hours: allocatedHours
    };

    setSavingRowKey(key);
    setLastSavedRowKey(null);
    setNotice(null);
    setError(null);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

    try {
      const response = await fetch("/api/admin/teacher-workload-allocations", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        const received = "debug" in body ? body.debug?.received : null;
        const debugText = saveDebugText({
          initials: row.initials,
          teacher_id: String(received?.teacher_id ?? payload.teacher_id),
          workload_year_id: String(received?.workload_year_id ?? payload.workload_year_id),
          allocated_hours: parseHours(String(received?.allocated_hours ?? payload.allocated_hours))
        });
        setError(`Gem fejlede (${response.status}): ${apiError}`);
        setRowErrors((current) => ({
          ...current,
          [key]: `Gem fejlede (${response.status}): ${apiError}. ${debugText}`
        }));
        return;
      }

      const savedAllocatedHours = body.allocation.allocated_hours;

      setLocalRows((current) =>
        current.map((currentRow) =>
          rowKey(currentRow) === key
            ? {
                ...currentRow,
                allocated_hours: savedAllocatedHours,
                remaining_hours: remainingFor(currentRow, savedAllocatedHours),
                status: statusFor(currentRow, savedAllocatedHours)
              }
            : currentRow
        )
      );
      setDraftHours((current) => ({
        ...current,
        [key]: inputValue(savedAllocatedHours)
      }));
      setNotice(`Årstimer gemt for ${row.initials}.`);
      setError(null);
      setRowErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setLastSavedRowKey(key);
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setError(message);
      setRowErrors((current) => ({
        ...current,
        [key]: `${message}. ${saveDebugText({
          initials: row.initials,
          teacher_id: payload.teacher_id,
          workload_year_id: payload.workload_year_id,
          allocated_hours: payload.allocated_hours
        })}`
      }));
    } finally {
      setSavingRowKey(null);
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
        {!localRows.length && debug ? (
          <div className="notice">
            <strong>Debug</strong>
            <ul>
              <li>Aktivt workload year fundet: {debug.active_workload_year_found ? "ja" : "nej"}</li>
              <li>Rows fra v_teacher_workload_status: {debug.view_rows}</li>
              <li>Rows fra v_teacher_workload_status for aktivt år: {debug.active_view_rows}</li>
              <li>Teachers: {debug.teachers}</li>
              <li>Allocations: {debug.allocations}</li>
            </ul>
          </div>
        ) : null}
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
                  const key = rowKey(row);
                  const isSaving = savingRowKey === key;
                  const identityIssue = rowIdentityIssue(row);
                  const draftValue = draftHours[key] ?? inputValue(row.allocated_hours);
                  const currentAllocatedHours = parseHours(draftValue);
                  const canEditRow = canWrite && !identityIssue;
                  const canSaveRow = canEditRow && currentAllocatedHours !== null;
                  const displayedRemainingHours = remainingFor(row, currentAllocatedHours);
                  const displayedStatus = statusFor(row, currentAllocatedHours);

                  return (
                    <tr key={key}>
                      <td>
                        <strong>{asText(row.initials)}</strong>
                      </td>
                      <td>{asText(row.display_name)}</td>
                      <td>{asText(row.workload_year_label)}</td>
                      <td>
                        <input
                          className="workload-hours-input"
                          disabled={!canEditRow || isSaving}
                          inputMode="decimal"
                          min="0"
                          name={`allocated_hours_${key}`}
                          onChange={(event) =>
                            setDraftHours((current) => ({
                              ...current,
                              [key]: event.target.value
                            }))
                          }
                          readOnly={!canEditRow}
                          step="0.25"
                          type="text"
                          value={draftValue}
                        />
                      </td>
                      <td>{hours(row.assigned_hours_known)}</td>
                      <td>{row.assigned_hours_missing}</td>
                      <td>{row.is_pseudo_resource ? "-" : hours(displayedRemainingHours)}</td>
                      <td>{statusBadge(displayedStatus, row.is_pseudo_resource)}</td>
                      <td>
                        <button
                          className="button-secondary"
                          disabled={!canSaveRow || isSaving}
                          onClick={() => void saveAllocatedHours(row)}
                          type="button"
                          title={identityIssue || undefined}
                        >
                          {isSaving ? "Gemmer..." : "Gem"}
                        </button>
                        {identityIssue ? <small>{identityIssue}</small> : null}
                        {rowErrors[key] ? <small>{rowErrors[key]}</small> : null}
                        {lastSavedRowKey === key && !isSaving ? <small>Sidst gemt</small> : null}
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
