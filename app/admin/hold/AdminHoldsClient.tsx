"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { asText } from "../../../lib/format";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";
import type { AdminHoldOptionRow, AdminHoldRow, AdminHoldsSchemaInfo, AdminHoldSchoolRow } from "../../../lib/adminHoldsData";

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

type ApiHold = {
  id: string;
  school_id: string;
  campus_id: string | null;
  legacy_id: string | null;
  name: string;
  address_label: string;
  default_period_weeks: number | null;
  class_category_id: string | null;
  education_program_id: string | null;
  planning_notes: string | null;
  scheduling_notes: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
};

type ApiResult =
  | { success: true; status: "created" | "updated" | "unchanged" | "deactivated" | "reactivated"; hold: ApiHold }
  | { success: false; error: string };

type HoldDraft = {
  school_id?: string;
  name: string;
  legacy_id: string;
  address_label: string;
  campus_id: string;
  class_category_id: string;
  education_program_id: string;
  default_period_weeks: string;
  planning_notes: string;
  scheduling_notes: string;
};

type Props = {
  holds: AdminHoldRow[];
  schools: AdminHoldSchoolRow[];
  campuses: AdminHoldOptionRow[];
  categories: AdminHoldOptionRow[];
  programs: AdminHoldOptionRow[];
  schema: AdminHoldsSchemaInfo;
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

function holdDraft(hold: AdminHoldRow): HoldDraft {
  return {
    name: hold.name,
    legacy_id: hold.legacy_id || "",
    address_label: hold.address_label || "",
    campus_id: hold.campus_id || "",
    class_category_id: hold.class_category_id || "",
    education_program_id: hold.education_program_id || "",
    default_period_weeks: hold.default_period_weeks === null ? "" : String(hold.default_period_weeks),
    planning_notes: hold.planning_notes || "",
    scheduling_notes: hold.scheduling_notes || ""
  };
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseWeeks(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function hasDraftChanges(hold: AdminHoldRow, draft: HoldDraft) {
  return (
    hold.name !== draft.name.trim() ||
    (hold.legacy_id || "") !== (normalizeText(draft.legacy_id) || "") ||
    hold.address_label !== draft.address_label.trim() ||
    (hold.campus_id || "") !== draft.campus_id ||
    (hold.class_category_id || "") !== draft.class_category_id ||
    (hold.education_program_id || "") !== draft.education_program_id ||
    (hold.default_period_weeks ?? null) !== parseWeeks(draft.default_period_weeks) ||
    (hold.planning_notes || "") !== (normalizeText(draft.planning_notes) || "") ||
    (hold.scheduling_notes || "") !== (normalizeText(draft.scheduling_notes) || "")
  );
}

function sortHolds(holds: AdminHoldRow[]) {
  return [...holds].sort((a, b) => a.name.localeCompare(b.name, "da") || a.school_name.localeCompare(b.school_name, "da"));
}

function findOptionLabel(options: AdminHoldOptionRow[], id: string | null, fallback: string) {
  if (!id) return fallback;
  const option = options.find((candidate) => candidate.id === id);
  return option ? option.label : fallback;
}

function mapApiHold(
  hold: ApiHold,
  input: {
    schools: AdminHoldSchoolRow[];
    campuses: AdminHoldOptionRow[];
    categories: AdminHoldOptionRow[];
    programs: AdminHoldOptionRow[];
    existing?: AdminHoldRow;
  }
): AdminHoldRow {
  const school = input.schools.find((candidate) => candidate.id === hold.school_id);
  const isActive = hold.is_active !== false;

  return {
    id: hold.id,
    school_id: hold.school_id,
    school_name: school?.name || school?.slug || input.existing?.school_name || "-",
    legacy_id: hold.legacy_id ?? null,
    name: hold.name,
    address_label: hold.address_label,
    campus_id: hold.campus_id ?? null,
    campus_name: findOptionLabel(input.campuses, hold.campus_id, hold.address_label || "-"),
    class_category_id: hold.class_category_id ?? null,
    category_name: findOptionLabel(input.categories, hold.class_category_id, "-"),
    category_key: input.categories.find((candidate) => candidate.id === hold.class_category_id)?.detail || null,
    education_program_id: hold.education_program_id ?? null,
    program_name: findOptionLabel(input.programs, hold.education_program_id, "-"),
    program_code: input.programs.find((candidate) => candidate.id === hold.education_program_id)?.detail || null,
    default_period_weeks: hold.default_period_weeks ?? null,
    planning_notes: hold.planning_notes ?? null,
    scheduling_notes: hold.scheduling_notes ?? null,
    metadata: hold.metadata || {},
    is_active: isActive,
    archived_at: hold.archived_at ?? null,
    archived_by: hold.archived_by ?? null,
    archived_reason: hold.archived_reason ?? null,
    created_at: hold.created_at,
    updated_at: hold.updated_at,
    active_weeks_count: input.existing?.active_weeks_count || 0,
    active_weeks_range: input.existing?.active_weeks_range || "-",
    subject_offerings_count: input.existing?.subject_offerings_count || 0,
    requirement_count: input.existing?.requirement_count || 0,
    calendar_event_count: input.existing?.calendar_event_count || 0,
    status_label: isActive ? "Aktiv" : "Inaktiv"
  };
}

function initialCreateDraft(schools: AdminHoldSchoolRow[]): HoldDraft {
  return {
    school_id: schools[0]?.id || "",
    name: "",
    legacy_id: "",
    address_label: "",
    campus_id: "",
    class_category_id: "",
    education_program_id: "",
    default_period_weeks: "",
    planning_notes: "",
    scheduling_notes: ""
  };
}

function optionLabel(option: AdminHoldOptionRow) {
  return option.detail ? `${option.label} (${option.detail})` : option.label;
}

export function AdminHoldsClient({ holds, schools, campuses, categories, programs, schema }: Props) {
  const router = useRouter();
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse>(emptyStatus());
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [localHolds, setLocalHolds] = useState<AdminHoldRow[]>(holds);
  const [drafts, setDrafts] = useState<Record<string, HoldDraft>>({});
  const [createDraft, setCreateDraft] = useState<HoldDraft>(() => initialCreateDraft(schools));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    setLocalHolds(holds);
    setDrafts({});
    setLastSavedId(null);
  }, [holds]);

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
  const createReady = Boolean(createDraft.school_id && createDraft.name.trim() && createDraft.address_label.trim());
  const createSchoolIssue = schools.length
    ? null
    : "Kan ikke oprette hold, fordi der ikke kunne findes en skole fra schools, aktivt skoleår eller eksisterende hold.";
  const lifecycleMessage = schema.supports_deactivation
    ? "Deaktivering er soft lifecycle: holdet bliver inaktivt, men slettes ikke."
    : "class_groups har ikke is_active, archived_at, archived_by og archived_reason endnu. Kør migration 019 før deaktivering aktiveres.";

  const schoolOptions = useMemo(
    () =>
      schools.map((school) => ({
        id: school.id,
        label: school.slug ? `${school.name} (${school.slug})` : school.name,
        source: school.source
      })),
    [schools]
  );
  const selectedSchool = schoolOptions.find((school) => school.id === createDraft.school_id) || schoolOptions[0] || null;

  function updateDraft(hold: AdminHoldRow, patch: Partial<HoldDraft>) {
    setDrafts((current) => ({
      ...current,
      [hold.id]: {
        ...holdDraft(hold),
        ...current[hold.id],
        ...patch
      }
    }));
  }

  function payloadFromDraft(draft: HoldDraft) {
    const weeks = parseWeeks(draft.default_period_weeks);

    return {
      school_id: draft.school_id,
      name: draft.name.trim(),
      legacy_id: normalizeText(draft.legacy_id),
      address_label: draft.address_label.trim(),
      campus_id: normalizeText(draft.campus_id),
      class_category_id: normalizeText(draft.class_category_id),
      education_program_id: normalizeText(draft.education_program_id),
      default_period_weeks: Number.isNaN(weeks) ? draft.default_period_weeks : weeks,
      planning_notes: normalizeText(draft.planning_notes),
      scheduling_notes: normalizeText(draft.scheduling_notes)
    };
  }

  async function createHold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at oprette hold.");
      return;
    }

    if (!createReady) {
      setError("Holdnavn, adresse/lokation og skole skal udfyldes.");
      return;
    }

    setSavingKey("create");
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/holds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "create",
          ...payloadFromDraft(createDraft)
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Opret fejlede (${response.status}): ${apiError}`);
        return;
      }

      const created = mapApiHold(body.hold, { schools, campuses, categories, programs });
      setLocalHolds((current) => sortHolds([...current, created]));
      setCreateDraft(initialCreateDraft(schools));
      setNotice(`Holdet ${created.name} blev oprettet.`);
      setLastSavedId(created.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveHold(hold: AdminHoldRow) {
    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at redigere hold.");
      return;
    }

    const draft = drafts[hold.id] || holdDraft(hold);

    if (!draft.name.trim() || !draft.address_label.trim()) {
      setError("Holdnavn og adresse/lokation skal udfyldes.");
      return;
    }

    setSavingKey(`update:${hold.id}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/holds", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "update",
          id: hold.id,
          ...payloadFromDraft(draft)
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Gem fejlede (${response.status}): ${apiError}`);
        return;
      }

      const updated = mapApiHold(body.hold, { schools, campuses, categories, programs, existing: hold });
      setLocalHolds((current) => sortHolds(current.map((candidate) => (candidate.id === hold.id ? updated : candidate))));
      setDrafts((current) => {
        const next = { ...current };
        delete next[hold.id];
        return next;
      });
      setNotice(body.status === "unchanged" ? `${updated.name} var allerede opdateret.` : `${updated.name} blev gemt.`);
      setLastSavedId(hold.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  async function updateLifecycle(hold: AdminHoldRow, action: "deactivate" | "reactivate") {
    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at ændre holdstatus.");
      return;
    }

    if (!schema.supports_deactivation) {
      setError("Kør migration 019, før hold kan deaktiveres.");
      return;
    }

    setSavingKey(`${action}:${hold.id}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/holds", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action,
          id: hold.id,
          archived_reason: action === "deactivate" ? "Admin deactivation from /admin/hold" : null
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`${action === "deactivate" ? "Deaktivér" : "Genaktivér"} fejlede (${response.status}): ${apiError}`);
        return;
      }

      const updated = mapApiHold(body.hold, { schools, campuses, categories, programs, existing: hold });
      setLocalHolds((current) => sortHolds(current.map((candidate) => (candidate.id === hold.id ? updated : candidate))));
      setNotice(
        body.status === "unchanged"
          ? `${updated.name} havde allerede den status.`
          : action === "deactivate"
            ? `${updated.name} blev deaktiveret.`
            : `${updated.name} blev genaktiveret.`
      );
      setLastSavedId(hold.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="admin-holds-client">
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
        {!canWrite && !loadingAuth ? <p className="notice">Hold er read-only for viewer og ikke-loggede brugere.</p> : null}
        {schema.supports_deactivation ? <p className="status-message">{lifecycleMessage}</p> : <p className="notice">{lifecycleMessage}</p>}
        {createSchoolIssue ? <p className="notice">{createSchoolIssue}</p> : null}
        {status.warning ? <p className="notice">{status.warning}</p> : null}
        {status.error ? <p className="notice">{status.error}</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {notice ? <p className="status-message">{notice}</p> : null}
      </section>

      <section className="content-section">
        <h2>Opret hold</h2>
        <form className="admin-hold-form" onSubmit={(event) => void createHold(event)}>
          <label>
            Skole
            {schoolOptions.length <= 1 ? (
              <input
                disabled
                readOnly
                type="text"
                value={
                  selectedSchool
                    ? `${selectedSchool.label}${selectedSchool.source === "schools" ? "" : " - automatisk fundet"}`
                    : "Ingen skole fundet"
                }
              />
            ) : (
              <select
                disabled={!canWrite || savingKey === "create"}
                onChange={(event) =>
                  setCreateDraft((current) => ({
                    ...current,
                    school_id: event.target.value
                  }))
                }
                value={createDraft.school_id}
              >
                {schoolOptions.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.label}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label>
            Hold
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Holdkode/navn"
              readOnly={!canWrite}
              type="text"
              value={createDraft.name}
            />
          </label>
          <label>
            Importnøgle
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, legacy_id: event.target.value }))}
              placeholder="Valgfri"
              readOnly={!canWrite}
              type="text"
              value={createDraft.legacy_id}
            />
          </label>
          <label>
            Adresse/lokation
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, address_label: event.target.value }))}
              placeholder="Aars, Hobro..."
              readOnly={!canWrite}
              type="text"
              value={createDraft.address_label}
            />
          </label>
          <label>
            Campus
            <select
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, campus_id: event.target.value }))}
              value={createDraft.campus_id}
            >
              <option value="">Ingen valgt</option>
              {campuses.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kategori
            <select
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, class_category_id: event.target.value }))}
              value={createDraft.class_category_id}
            >
              <option value="">Ingen valgt</option>
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Program
            <select
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, education_program_id: event.target.value }))}
              value={createDraft.education_program_id}
            >
              <option value="">Ingen valgt</option>
              {programs.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Standarduger
            <input
              disabled={!canWrite || savingKey === "create"}
              inputMode="numeric"
              onChange={(event) => setCreateDraft((current) => ({ ...current, default_period_weeks: event.target.value }))}
              placeholder="Valgfri"
              readOnly={!canWrite}
              type="text"
              value={createDraft.default_period_weeks}
            />
          </label>
          <button disabled={!canWrite || !createReady || Boolean(createSchoolIssue) || savingKey === "create"} type="submit">
            {savingKey === "create" ? "Opretter..." : "Opret hold"}
          </button>
        </form>
      </section>

      <section className="content-section">
        <h2>Hold</h2>
        <div className="table-wrap">
          <table className="admin-hold-table">
            <thead>
              <tr>
                <th>Hold</th>
                <th>Lokation</th>
                <th>Kategori</th>
                <th>Program</th>
                <th>Uger</th>
                <th>Relationer</th>
                <th>Noter</th>
                <th>Status</th>
                <th>Handling</th>
              </tr>
            </thead>
            <tbody>
              {localHolds.length ? (
                localHolds.map((hold) => {
                  const draft = drafts[hold.id] || holdDraft(hold);
                  const isSaving = savingKey === `update:${hold.id}`;
                  const isLifecycleSaving = savingKey === `deactivate:${hold.id}` || savingKey === `reactivate:${hold.id}`;
                  const isDirty = hasDraftChanges(hold, draft);
                  const canEdit = canWrite && !isSaving && !isLifecycleSaving;
                  const lifecycleAction = hold.is_active ? "deactivate" : "reactivate";

                  return (
                    <tr className={hold.is_active ? undefined : "inactive-hold-row"} key={hold.id}>
                      <td>
                        <input
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { name: event.target.value })}
                          readOnly={!canEdit}
                          type="text"
                          value={draft.name}
                        />
                        <input
                          className="hold-field-input hold-small-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { legacy_id: event.target.value })}
                          placeholder="Importnøgle"
                          readOnly={!canEdit}
                          type="text"
                          value={draft.legacy_id}
                        />
                      </td>
                      <td>
                        <input
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { address_label: event.target.value })}
                          readOnly={!canEdit}
                          type="text"
                          value={draft.address_label}
                        />
                        <select
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { campus_id: event.target.value })}
                          value={draft.campus_id}
                        >
                          <option value="">Ingen campus</option>
                          {campuses.map((option) => (
                            <option key={option.id} value={option.id}>
                              {optionLabel(option)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { class_category_id: event.target.value })}
                          value={draft.class_category_id}
                        >
                          <option value="">Ingen kategori</option>
                          {categories.map((option) => (
                            <option key={option.id} value={option.id}>
                              {optionLabel(option)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { education_program_id: event.target.value })}
                          value={draft.education_program_id}
                        >
                          <option value="">Ingen program</option>
                          {programs.map((option) => (
                            <option key={option.id} value={option.id}>
                              {optionLabel(option)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="hold-field-input hold-number-input"
                          disabled={!canEdit}
                          inputMode="numeric"
                          onChange={(event) => updateDraft(hold, { default_period_weeks: event.target.value })}
                          readOnly={!canEdit}
                          type="text"
                          value={draft.default_period_weeks}
                        />
                        <small>Aktive: {hold.active_weeks_count} ({hold.active_weeks_range})</small>
                      </td>
                      <td>
                        <span>Fagudbud: {hold.subject_offerings_count}</span>
                        <small>Krav: {hold.requirement_count}</small>
                        <small>Kalender: {hold.calendar_event_count}</small>
                      </td>
                      <td>
                        <input
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { planning_notes: event.target.value })}
                          placeholder="Planlægning"
                          readOnly={!canEdit}
                          type="text"
                          value={draft.planning_notes}
                        />
                        <input
                          className="hold-field-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(hold, { scheduling_notes: event.target.value })}
                          placeholder="Skema"
                          readOnly={!canEdit}
                          type="text"
                          value={draft.scheduling_notes}
                        />
                      </td>
                      <td>
                        <span className={`badge ${hold.is_active ? "badge-info" : "badge-warning"}`}>{hold.status_label}</span>
                        {hold.archived_at ? <small>{asText(hold.archived_reason, "Arkiveret")}</small> : null}
                      </td>
                      <td>
                        <div className="hold-actions">
                          <button
                            className="button-secondary"
                            disabled={!canWrite || !isDirty || isSaving || isLifecycleSaving}
                            onClick={() => void saveHold(hold)}
                            type="button"
                          >
                            {isSaving ? "Gemmer..." : "Gem"}
                          </button>
                          <button
                            className="button-secondary"
                            disabled={!canWrite || !schema.supports_deactivation || isLifecycleSaving || isSaving}
                            onClick={() => void updateLifecycle(hold, lifecycleAction)}
                            title={lifecycleMessage}
                            type="button"
                          >
                            {isLifecycleSaving ? "Gemmer..." : hold.is_active ? "Deaktivér" : "Genaktivér"}
                          </button>
                          {lastSavedId === hold.id && !isSaving && !isLifecycleSaving ? <small>Sidst gemt</small> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={9}>
                    Ingen hold fundet.
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
