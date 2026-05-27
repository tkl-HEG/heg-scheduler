"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { asText } from "../../../lib/format";
import { createBrowserSupabaseClient, getSupabaseBrowserConfig } from "../../../lib/supabaseBrowser";
import type {
  AdminSubjectOfferingClassGroupOption,
  AdminSubjectOfferingClassGroupRow,
  AdminSubjectOfferingRow,
  AdminSubjectOfferingSchoolRow,
  AdminSubjectOfferingsSchemaInfo,
  AdminSubjectOfferingSubjectOption,
  PeriodUnit,
  SubjectPriority
} from "../../../lib/adminSubjectOfferingsData";

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

type ApiOffering = {
  id: string;
  school_id: string;
  legacy_id: string | null;
  class_group_id: string;
  course_subject_id: string;
  pairing_group_id: string | null;
  name: string;
  total_hours: number | string;
  hours_missing: boolean;
  hours_source: string | null;
  period_value: number;
  period_unit: PeriodUnit;
  start_week: number;
  priority: SubjectPriority;
  sort_order: number | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
  created_at: string;
  updated_at: string;
};

type ApiMembership = {
  subject_offering_id: string;
  class_group_id: string;
  school_id: string;
  member_role: string;
  sort_order: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ApiResult =
  | {
      success: true;
      status: "created" | "updated" | "unchanged" | "deactivated" | "reactivated";
      offering: ApiOffering;
      memberships: ApiMembership[];
      class_group_ids: string[];
    }
  | { success: false; error: string };

type OfferingDraft = {
  course_subject_id: string;
  class_group_ids: string[];
  total_hours: string;
  hours_missing: boolean;
  hours_source: string;
  period_value: string;
  period_unit: PeriodUnit;
  start_week: string;
  priority: SubjectPriority;
  sort_order: string;
};

type CreateDraft = OfferingDraft & {
  school_id: string;
};

type Props = {
  offerings: AdminSubjectOfferingRow[];
  schools: AdminSubjectOfferingSchoolRow[];
  subjects: AdminSubjectOfferingSubjectOption[];
  classGroups: AdminSubjectOfferingClassGroupOption[];
  schema: AdminSubjectOfferingsSchemaInfo;
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

function decimalText(value: unknown) {
  if (value === null || value === undefined || value === "") return "0";
  return String(value);
}

function optionalIntegerText(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function offeringDraft(offering: AdminSubjectOfferingRow): OfferingDraft {
  return {
    course_subject_id: offering.course_subject_id,
    class_group_ids: offering.class_group_ids.length ? offering.class_group_ids : [offering.class_group_id],
    total_hours: decimalText(offering.total_hours),
    hours_missing: offering.hours_missing,
    hours_source: offering.hours_source || "",
    period_value: String(offering.period_value || 1),
    period_unit: offering.period_unit,
    start_week: String(offering.start_week || 1),
    priority: offering.priority,
    sort_order: optionalIntegerText(offering.sort_order)
  };
}

function firstSchoolId(
  schools: AdminSubjectOfferingSchoolRow[],
  subjects: AdminSubjectOfferingSubjectOption[],
  classGroups: AdminSubjectOfferingClassGroupOption[]
) {
  return schools[0]?.id || subjects[0]?.school_id || classGroups[0]?.school_id || "";
}

function initialCreateDraft(
  schools: AdminSubjectOfferingSchoolRow[],
  subjects: AdminSubjectOfferingSubjectOption[],
  classGroups: AdminSubjectOfferingClassGroupOption[]
): CreateDraft {
  const schoolId = firstSchoolId(schools, subjects, classGroups);
  const firstSubject = subjects.find((subject) => subject.school_id === schoolId) || subjects[0] || null;
  const firstClassGroup = classGroups.find((classGroup) => classGroup.school_id === schoolId) || classGroups[0] || null;

  return {
    school_id: schoolId,
    course_subject_id: firstSubject?.id || "",
    class_group_ids: firstClassGroup ? [firstClassGroup.id] : [],
    total_hours: "0",
    hours_missing: false,
    hours_source: "",
    period_value: "1",
    period_unit: "weeks",
    start_week: "1",
    priority: "medium",
    sort_order: ""
  };
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsedNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function parsedInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function payloadFromDraft(draft: OfferingDraft) {
  const totalHours = parsedNumber(draft.total_hours);
  const periodValue = parsedInteger(draft.period_value);
  const startWeek = parsedInteger(draft.start_week);
  const sortOrder = draft.sort_order.trim() ? parsedInteger(draft.sort_order) : null;

  if (!draft.course_subject_id) return { payload: null, error: "Vælg et fag." };
  if (!draft.class_group_ids.length) return { payload: null, error: "Vælg mindst ét hold." };
  if (totalHours === null || totalHours < 0) return { payload: null, error: "Timer skal være et gyldigt tal på mindst 0." };
  if (periodValue === null || periodValue < 1 || periodValue > 500) {
    return { payload: null, error: "Periodeværdi skal være et heltal mellem 1 og 500." };
  }
  if (startWeek === null || startWeek < 1 || startWeek > 80) {
    return { payload: null, error: "Startuge skal være et heltal mellem 1 og 80." };
  }
  if (draft.sort_order.trim() && sortOrder === null) return { payload: null, error: "Sortering skal være et heltal eller tom." };

  return {
    payload: {
      course_subject_id: draft.course_subject_id,
      class_group_ids: draft.class_group_ids,
      total_hours: totalHours,
      hours_missing: draft.hours_missing,
      hours_source: normalizedText(draft.hours_source),
      period_value: periodValue,
      period_unit: draft.period_unit,
      start_week: startWeek,
      priority: draft.priority,
      sort_order: sortOrder
    },
    error: null
  };
}

function sameNumberText(left: unknown, rightText: string) {
  const leftNumber = parsedNumber(decimalText(left));
  const rightNumber = parsedNumber(rightText);
  return leftNumber === rightNumber;
}

function sameOptionalInteger(left: number | null, rightText: string) {
  const right = rightText.trim() ? parsedInteger(rightText) : null;
  return (left ?? null) === right;
}

function hasDraftChanges(offering: AdminSubjectOfferingRow, draft: OfferingDraft) {
  const initial = offeringDraft(offering);

  return (
    offering.course_subject_id !== draft.course_subject_id ||
    !arraysEqual(initial.class_group_ids, draft.class_group_ids) ||
    !sameNumberText(offering.total_hours, draft.total_hours) ||
    offering.hours_missing !== draft.hours_missing ||
    (offering.hours_source || "") !== draft.hours_source.trim() ||
    String(offering.period_value || 1) !== draft.period_value.trim() ||
    offering.period_unit !== draft.period_unit ||
    String(offering.start_week || 1) !== draft.start_week.trim() ||
    offering.priority !== draft.priority ||
    !sameOptionalInteger(offering.sort_order, draft.sort_order)
  );
}

function sortOfferings(offerings: AdminSubjectOfferingRow[]) {
  return [...offerings].sort(
    (a, b) =>
      a.subject_name.localeCompare(b.subject_name, "da") ||
      (a.class_groups[0]?.class_group_name || a.legacy_class_group_name).localeCompare(
        b.class_groups[0]?.class_group_name || b.legacy_class_group_name,
        "da"
      )
  );
}

function classGroupLabel(classGroup: AdminSubjectOfferingClassGroupOption) {
  const detail = [classGroup.legacy_id, classGroup.address_label].filter(Boolean).join(" / ");
  return detail ? `${classGroup.name} (${detail})` : classGroup.name;
}

function mapApiOffering(
  body: Extract<ApiResult, { success: true }>,
  input: {
    schools: AdminSubjectOfferingSchoolRow[];
    subjects: AdminSubjectOfferingSubjectOption[];
    classGroups: AdminSubjectOfferingClassGroupOption[];
    existing?: AdminSubjectOfferingRow;
  }
): AdminSubjectOfferingRow {
  const school = input.schools.find((candidate) => candidate.id === body.offering.school_id);
  const subject = input.subjects.find((candidate) => candidate.id === body.offering.course_subject_id);
  const legacyClass = input.classGroups.find((candidate) => candidate.id === body.offering.class_group_id);
  const membershipSource = body.memberships.length
    ? body.memberships
    : body.class_group_ids.map((classGroupId, index) => ({
        subject_offering_id: body.offering.id,
        class_group_id: classGroupId,
        school_id: body.offering.school_id,
        member_role: index === 0 ? "primary" : "shared",
        sort_order: index + 1,
        metadata: {},
        created_at: body.offering.created_at,
        updated_at: body.offering.updated_at
      }));
  const memberships = membershipSource
    .map((membership): AdminSubjectOfferingClassGroupRow | null => {
      const classGroup = input.classGroups.find((candidate) => candidate.id === membership.class_group_id);
      if (!classGroup) return null;

      return {
        subject_offering_id: body.offering.id,
        class_group_id: membership.class_group_id,
        school_id: membership.school_id,
        member_role: membership.member_role,
        sort_order: membership.sort_order,
        class_group_name: classGroup.name,
        class_group_legacy_id: classGroup.legacy_id
      };
    })
    .filter(Boolean) as AdminSubjectOfferingClassGroupRow[];
  const isActive = body.offering.is_active !== false;

  return {
    id: body.offering.id,
    school_id: body.offering.school_id,
    school_name: school?.name || school?.slug || input.existing?.school_name || "-",
    legacy_id: body.offering.legacy_id ?? null,
    class_group_id: body.offering.class_group_id,
    course_subject_id: body.offering.course_subject_id,
    pairing_group_id: body.offering.pairing_group_id ?? null,
    pairing_group_name: input.existing?.pairing_group_name || null,
    name: body.offering.name,
    subject_name: subject?.name || body.offering.name || "-",
    subject_key: subject?.normalized_key ?? null,
    total_hours: body.offering.total_hours ?? null,
    hours_missing: Boolean(body.offering.hours_missing),
    hours_source: body.offering.hours_source ?? null,
    period_value: body.offering.period_value,
    period_unit: body.offering.period_unit,
    start_week: body.offering.start_week,
    priority: body.offering.priority,
    sort_order: body.offering.sort_order ?? null,
    metadata: body.offering.metadata || {},
    is_active: isActive,
    archived_at: body.offering.archived_at ?? null,
    archived_by: body.offering.archived_by ?? null,
    archived_reason: body.offering.archived_reason ?? null,
    created_at: body.offering.created_at,
    updated_at: body.offering.updated_at,
    legacy_class_group_name: legacyClass?.name || input.existing?.legacy_class_group_name || "-",
    class_groups: memberships,
    class_group_ids: memberships.map((membership) => membership.class_group_id),
    is_shared: memberships.length > 1,
    assignment_count: input.existing?.assignment_count || 0,
    suggestion_count: input.existing?.suggestion_count || 0,
    status_label: isActive ? "Aktiv" : "Inaktiv"
  };
}

function ClassGroupPicker({
  disabled,
  options,
  selectedIds,
  onChange
}: {
  disabled: boolean;
  options: AdminSubjectOfferingClassGroupOption[];
  selectedIds: string[];
  onChange: (nextIds: string[]) => void;
}) {
  function toggle(classGroupId: string, checked: boolean) {
    if (checked) {
      onChange(selectedIds.includes(classGroupId) ? selectedIds : [...selectedIds, classGroupId]);
      return;
    }

    onChange(selectedIds.filter((selectedId) => selectedId !== classGroupId));
  }

  if (!options.length) {
    return <p className="status-message">Ingen hold fundet.</p>;
  }

  return (
    <div className="class-group-picker">
      {options.map((classGroup) => (
        <label key={classGroup.id}>
          <input
            checked={selectedIds.includes(classGroup.id)}
            disabled={disabled}
            onChange={(event) => toggle(classGroup.id, event.target.checked)}
            type="checkbox"
          />
          <span>
            {classGroup.name}
            {classGroup.legacy_id ? <small>{classGroup.legacy_id}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

export function AdminSubjectOfferingsClient({ offerings, schools, subjects, classGroups, schema }: Props) {
  const router = useRouter();
  const config = getSupabaseBrowserConfig();
  const supabase = createBrowserSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AdminStatusResponse>(emptyStatus());
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [localOfferings, setLocalOfferings] = useState<AdminSubjectOfferingRow[]>(offerings);
  const [drafts, setDrafts] = useState<Record<string, OfferingDraft>>({});
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => initialCreateDraft(schools, subjects, classGroups));
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(config.issue);

  useEffect(() => {
    setLocalOfferings(offerings);
    setDrafts({});
    setLastSavedId(null);
  }, [offerings]);

  useEffect(() => {
    setCreateDraft((current) => {
      const validSchool = current.school_id && (schools.some((school) => school.id === current.school_id) || subjects.some((subject) => subject.school_id === current.school_id));

      return validSchool ? current : initialCreateDraft(schools, subjects, classGroups);
    });
  }, [schools, subjects, classGroups]);

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
  const schoolOptions = useMemo(
    () =>
      schools.map((school) => ({
        id: school.id,
        label: school.slug ? `${school.name} (${school.slug})` : school.name,
        source: school.source
      })),
    [schools]
  );
  const createSubjects = subjects.filter((subject) => subject.school_id === createDraft.school_id);
  const createClassGroups = classGroups.filter((classGroup) => classGroup.school_id === createDraft.school_id);
  const createReady = Boolean(createDraft.school_id && createDraft.course_subject_id && createDraft.class_group_ids.length);
  const createSchoolIssue = createDraft.school_id
    ? null
    : "Kan ikke oprette fagudbud, fordi der ikke kunne findes en skole fra schools, aktivt skoleår eller eksisterende fagudbud.";
  const lifecycleMessage = schema.supports_deactivation
    ? "Deaktivering er soft lifecycle: fagudbuddet bliver inaktivt, men slettes ikke."
    : "subject_offerings har ikke is_active, archived_at, archived_by og archived_reason endnu. Kør migration 021 før deaktivering aktiveres.";

  function updateCreateSchool(schoolId: string) {
    const nextSubject = subjects.find((subject) => subject.school_id === schoolId);
    const nextClassGroup = classGroups.find((classGroup) => classGroup.school_id === schoolId);

    setCreateDraft((current) => ({
      ...current,
      school_id: schoolId,
      course_subject_id: nextSubject?.id || "",
      class_group_ids: nextClassGroup ? [nextClassGroup.id] : []
    }));
  }

  function updateDraft(offering: AdminSubjectOfferingRow, patch: Partial<OfferingDraft>) {
    setDrafts((current) => ({
      ...current,
      [offering.id]: {
        ...offeringDraft(offering),
        ...current[offering.id],
        ...patch
      }
    }));
  }

  async function createOffering(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at oprette fagudbud.");
      return;
    }

    const parsed = payloadFromDraft(createDraft);

    if (!parsed.payload) {
      setError(parsed.error || "Fagudbudsinput er ugyldigt.");
      return;
    }

    setSavingKey("create");
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/subject-offerings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "create",
          school_id: createDraft.school_id,
          ...parsed.payload
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Opret fejlede (${response.status}): ${apiError}`);
        return;
      }

      const created = mapApiOffering(body, { schools, subjects, classGroups });
      setLocalOfferings((current) => sortOfferings([...current, created]));
      setCreateDraft(initialCreateDraft(schools, subjects, classGroups));
      setNotice(`${created.subject_name} blev oprettet som fagudbud.`);
      setLastSavedId(created.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveOffering(offering: AdminSubjectOfferingRow) {
    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at redigere fagudbud.");
      return;
    }

    const draft = drafts[offering.id] || offeringDraft(offering);
    const parsed = payloadFromDraft(draft);

    if (!parsed.payload) {
      setError(parsed.error || "Fagudbudsinput er ugyldigt.");
      return;
    }

    setSavingKey(`update:${offering.id}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/subject-offerings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "update",
          id: offering.id,
          ...parsed.payload
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`Gem fejlede (${response.status}): ${apiError}`);
        return;
      }

      const updated = mapApiOffering(body, { schools, subjects, classGroups, existing: offering });
      setLocalOfferings((current) => sortOfferings(current.map((candidate) => (candidate.id === offering.id ? updated : candidate))));
      setDrafts((current) => {
        const next = { ...current };
        delete next[offering.id];
        return next;
      });
      setNotice(body.status === "unchanged" ? `${updated.subject_name} var allerede opdateret.` : `${updated.subject_name} blev gemt.`);
      setLastSavedId(offering.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  async function updateLifecycle(offering: AdminSubjectOfferingRow, action: "deactivate" | "reactivate") {
    if (!session || !status.hasWriteAccess) {
      setError("Log ind som owner/admin/editor for at ændre fagudbudsstatus.");
      return;
    }

    if (!schema.supports_deactivation) {
      setError("Kør migration 021, før fagudbud kan deaktiveres.");
      return;
    }

    setSavingKey(`${action}:${offering.id}`);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/subject-offerings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action,
          id: offering.id,
          archived_reason: action === "deactivate" ? "Admin deactivation from /admin/fagudbud" : null
        })
      });

      const body = (await response.json()) as ApiResult;

      if (!response.ok || !body.success) {
        const apiError = "error" in body ? body.error : "Ukendt fejl";
        setError(`${action === "deactivate" ? "Deaktivér" : "Genaktivér"} fejlede (${response.status}): ${apiError}`);
        return;
      }

      const updated = mapApiOffering(body, { schools, subjects, classGroups, existing: offering });
      setLocalOfferings((current) => sortOfferings(current.map((candidate) => (candidate.id === offering.id ? updated : candidate))));
      setNotice(
        body.status === "unchanged"
          ? `${updated.subject_name} havde allerede den status.`
          : action === "deactivate"
            ? `${updated.subject_name} blev deaktiveret.`
            : `${updated.subject_name} blev genaktiveret.`
      );
      setLastSavedId(offering.id);
      router.refresh();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="admin-offerings-client">
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
        {!canWrite && !loadingAuth ? <p className="notice">Fagudbud er read-only for viewer og ikke-loggede brugere.</p> : null}
        {schema.supports_deactivation ? <p className="status-message">{lifecycleMessage}</p> : <p className="notice">{lifecycleMessage}</p>}
        {createSchoolIssue ? <p className="notice">{createSchoolIssue}</p> : null}
        {status.warning ? <p className="notice">{status.warning}</p> : null}
        {status.error ? <p className="notice">{status.error}</p> : null}
        {error ? <p className="notice">{error}</p> : null}
        {notice ? <p className="status-message">{notice}</p> : null}
      </section>

      <section className="content-section">
        <h2>Opret fagudbud</h2>
        <form className="admin-offering-form" onSubmit={(event) => void createOffering(event)}>
          <label>
            Skole
            {schoolOptions.length <= 1 ? (
              <input
                disabled
                readOnly
                type="text"
                value={schoolOptions[0]?.label || (createDraft.school_id ? "Skole" : "Ingen skole fundet")}
              />
            ) : (
              <select
                disabled={!canWrite || savingKey === "create"}
                onChange={(event) => updateCreateSchool(event.target.value)}
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
            Fag
            <select
              disabled={!canWrite || savingKey === "create" || !createSubjects.length}
              onChange={(event) => setCreateDraft((current) => ({ ...current, course_subject_id: event.target.value }))}
              value={createDraft.course_subject_id}
            >
              {createSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.normalized_key ? `${subject.name} (${subject.normalized_key})` : subject.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Timer
            <input
              disabled={!canWrite || savingKey === "create"}
              min="0"
              onChange={(event) => setCreateDraft((current) => ({ ...current, total_hours: event.target.value }))}
              readOnly={!canWrite}
              step="0.25"
              type="number"
              value={createDraft.total_hours}
            />
          </label>
          <label className="checkbox-preview admin-offering-checkbox">
            <input
              checked={createDraft.hours_missing}
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, hours_missing: event.target.checked }))}
              type="checkbox"
            />
            Timer mangler
          </label>
          <label>
            Kilde
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, hours_source: event.target.value }))}
              readOnly={!canWrite}
              type="text"
              value={createDraft.hours_source}
            />
          </label>
          <label>
            Periode
            <input
              disabled={!canWrite || savingKey === "create"}
              min="1"
              onChange={(event) => setCreateDraft((current) => ({ ...current, period_value: event.target.value }))}
              readOnly={!canWrite}
              type="number"
              value={createDraft.period_value}
            />
          </label>
          <label>
            Enhed
            <select
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, period_unit: event.target.value as PeriodUnit }))}
              value={createDraft.period_unit}
            >
              <option value="weeks">Uger</option>
              <option value="days">Dage</option>
            </select>
          </label>
          <label>
            Startuge
            <input
              disabled={!canWrite || savingKey === "create"}
              max="80"
              min="1"
              onChange={(event) => setCreateDraft((current) => ({ ...current, start_week: event.target.value }))}
              readOnly={!canWrite}
              type="number"
              value={createDraft.start_week}
            />
          </label>
          <label>
            Prioritet
            <select
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, priority: event.target.value as SubjectPriority }))}
              value={createDraft.priority}
            >
              <option value="high">Høj</option>
              <option value="medium">Mellem</option>
              <option value="low">Lav</option>
            </select>
          </label>
          <label>
            Sortering
            <input
              disabled={!canWrite || savingKey === "create"}
              onChange={(event) => setCreateDraft((current) => ({ ...current, sort_order: event.target.value }))}
              readOnly={!canWrite}
              type="number"
              value={createDraft.sort_order}
            />
          </label>
          <div className="admin-offering-holds">
            <span>Hold</span>
            <ClassGroupPicker
              disabled={!canWrite || savingKey === "create"}
              onChange={(nextIds) => setCreateDraft((current) => ({ ...current, class_group_ids: nextIds }))}
              options={createClassGroups}
              selectedIds={createDraft.class_group_ids}
            />
            <small>Primært hold: {asText(createClassGroups.find((classGroup) => classGroup.id === createDraft.class_group_ids[0])?.name)}</small>
          </div>
          <button disabled={!canWrite || !createReady || Boolean(createSchoolIssue) || savingKey === "create"} type="submit">
            {savingKey === "create" ? "Opretter..." : "Opret fagudbud"}
          </button>
        </form>
      </section>

      <section className="content-section">
        <h2>Fagudbud</h2>
        <div className="table-wrap">
          <table className="admin-offering-table">
            <thead>
              <tr>
                <th>Fag</th>
                <th>Hold</th>
                <th>Legacy/primær</th>
                <th>Timer</th>
                <th>Periode</th>
                <th>Relationer</th>
                <th>Status</th>
                <th>Handling</th>
              </tr>
            </thead>
            <tbody>
              {localOfferings.length ? (
                localOfferings.map((offering) => {
                  const draft = drafts[offering.id] || offeringDraft(offering);
                  const rowSubjects = subjects.filter((subject) => subject.school_id === offering.school_id);
                  const rowClassGroups = classGroups.filter((classGroup) => classGroup.school_id === offering.school_id);
                  const primaryClassGroup = rowClassGroups.find((classGroup) => classGroup.id === draft.class_group_ids[0]);
                  const isSaving = savingKey === `update:${offering.id}`;
                  const isLifecycleSaving =
                    savingKey === `deactivate:${offering.id}` || savingKey === `reactivate:${offering.id}`;
                  const isDirty = hasDraftChanges(offering, draft);
                  const canEdit = canWrite && !isSaving && !isLifecycleSaving && offering.is_active;
                  const lifecycleAction = offering.is_active ? "deactivate" : "reactivate";

                  return (
                    <tr className={offering.is_active ? undefined : "inactive-offering-row"} key={offering.id}>
                      <td>
                        <select
                          className="offering-field-input offering-subject-select"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(offering, { course_subject_id: event.target.value })}
                          value={draft.course_subject_id}
                        >
                          {rowSubjects.map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.normalized_key ? `${subject.name} (${subject.normalized_key})` : subject.name}
                            </option>
                          ))}
                        </select>
                        <small>{asText(offering.subject_key)}</small>
                        {draft.class_group_ids.length > 1 ? <span className="badge badge-info">Sammenlæst</span> : null}
                      </td>
                      <td>
                        <ClassGroupPicker
                          disabled={!canEdit}
                          onChange={(nextIds) => updateDraft(offering, { class_group_ids: nextIds })}
                          options={rowClassGroups}
                          selectedIds={draft.class_group_ids}
                        />
                        <small>Primært hold: {asText(primaryClassGroup?.name)}</small>
                      </td>
                      <td>
                        {asText(offering.legacy_class_group_name)}
                        <small>{offering.class_group_id}</small>
                      </td>
                      <td>
                        <input
                          className="offering-field-input offering-number-input"
                          disabled={!canEdit}
                          min="0"
                          onChange={(event) => updateDraft(offering, { total_hours: event.target.value })}
                          readOnly={!canEdit}
                          step="0.25"
                          type="number"
                          value={draft.total_hours}
                        />
                        <label className="checkbox-preview offering-inline-checkbox">
                          <input
                            checked={draft.hours_missing}
                            disabled={!canEdit}
                            onChange={(event) => updateDraft(offering, { hours_missing: event.target.checked })}
                            type="checkbox"
                          />
                          Mangler
                        </label>
                        <input
                          className="offering-field-input offering-source-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(offering, { hours_source: event.target.value })}
                          placeholder="Kilde"
                          readOnly={!canEdit}
                          type="text"
                          value={draft.hours_source}
                        />
                      </td>
                      <td>
                        <div className="offering-period-grid">
                          <input
                            className="offering-field-input offering-number-input"
                            disabled={!canEdit}
                            min="1"
                            onChange={(event) => updateDraft(offering, { period_value: event.target.value })}
                            readOnly={!canEdit}
                            type="number"
                            value={draft.period_value}
                          />
                          <select
                            className="offering-field-input"
                            disabled={!canEdit}
                            onChange={(event) => updateDraft(offering, { period_unit: event.target.value as PeriodUnit })}
                            value={draft.period_unit}
                          >
                            <option value="weeks">Uger</option>
                            <option value="days">Dage</option>
                          </select>
                          <input
                            className="offering-field-input offering-number-input"
                            disabled={!canEdit}
                            max="80"
                            min="1"
                            onChange={(event) => updateDraft(offering, { start_week: event.target.value })}
                            readOnly={!canEdit}
                            type="number"
                            value={draft.start_week}
                          />
                          <select
                            className="offering-field-input"
                            disabled={!canEdit}
                            onChange={(event) => updateDraft(offering, { priority: event.target.value as SubjectPriority })}
                            value={draft.priority}
                          >
                            <option value="high">Høj</option>
                            <option value="medium">Mellem</option>
                            <option value="low">Lav</option>
                          </select>
                        </div>
                        <input
                          className="offering-field-input offering-number-input"
                          disabled={!canEdit}
                          onChange={(event) => updateDraft(offering, { sort_order: event.target.value })}
                          placeholder="Sort"
                          readOnly={!canEdit}
                          type="number"
                          value={draft.sort_order}
                        />
                      </td>
                      <td>
                        <span>Lærere: {offering.assignment_count}</span>
                        <small>Forslag: {offering.suggestion_count}</small>
                        {offering.pairing_group_name ? <small>Sammenlæsningsgruppe: {offering.pairing_group_name}</small> : null}
                      </td>
                      <td>
                        <span className={`badge ${offering.is_active ? "badge-info" : "badge-warning"}`}>{offering.status_label}</span>
                        {offering.archived_at ? <small>{asText(offering.archived_reason, "Arkiveret")}</small> : null}
                      </td>
                      <td>
                        <div className="offering-actions">
                          <button
                            className="button-secondary"
                            disabled={!canWrite || !isDirty || isSaving || isLifecycleSaving || !offering.is_active}
                            onClick={() => void saveOffering(offering)}
                            type="button"
                          >
                            {isSaving ? "Gemmer..." : "Gem"}
                          </button>
                          <button
                            className="button-secondary"
                            disabled={!canWrite || !schema.supports_deactivation || isLifecycleSaving || isSaving}
                            onClick={() => void updateLifecycle(offering, lifecycleAction)}
                            title={lifecycleMessage}
                            type="button"
                          >
                            {isLifecycleSaving ? "Gemmer..." : offering.is_active ? "Deaktivér" : "Genaktivér"}
                          </button>
                          {lastSavedId === offering.id && !isSaving && !isLifecycleSaving ? <small>Sidst gemt</small> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-cell" colSpan={8}>
                    Ingen fagudbud fundet.
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
