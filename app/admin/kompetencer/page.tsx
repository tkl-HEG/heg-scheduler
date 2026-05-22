import Link from "next/link";
import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText } from "../../../lib/format";
import {
  getAdminCompetenciesData,
  type AdminCompetencyMatrixRow,
  type AdminSubjectRow,
  type AdminTeacherRow
} from "../../../lib/adminCompetenciesData";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ViewMode = "all" | "with_competence" | "without_competence";
type MatrixState = AdminCompetencyMatrixRow["subject_states"][number];

type AdminCompetencyFilters = {
  teacher: string;
  subject: string;
  mode: ViewMode;
};

const modeOptions: { value: ViewMode; label: string }[] = [
  { value: "all", label: "Vis alle fag" },
  { value: "with_competence", label: "Vis kun fag hvor læreren har kompetence" },
  { value: "without_competence", label: "Vis kun fag uden kompetence" }
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function parseMode(value: string): ViewMode {
  return modeOptions.some((option) => option.value === value) ? (value as ViewMode) : "all";
}

function parseFilters(params: Record<string, string | string[] | undefined>): AdminCompetencyFilters {
  return {
    teacher: firstParam(params.teacher).trim(),
    subject: firstParam(params.subject).trim(),
    mode: parseMode(firstParam(params.mode))
  };
}

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLocaleLowerCase("da-DK");
}

function teacherLabel(teacher: AdminTeacherRow) {
  return teacher.display_name ? `${teacher.initials} - ${teacher.display_name}` : teacher.initials;
}

function teacherMatches(teacher: AdminTeacherRow, needle: string) {
  if (!needle) return true;
  return normalize(teacher.initials).includes(needle) || normalize(teacher.display_name).includes(needle);
}

function subjectMatches(subject: AdminSubjectRow, needle: string) {
  if (!needle) return true;
  return normalize(subject.name).includes(needle);
}

function stateMatchesMode(state: MatrixState, mode: ViewMode) {
  if (mode === "with_competence") return state.has_competency;
  if (mode === "without_competence") return !state.has_competency;
  return true;
}

function hasActiveFilters(filters: AdminCompetencyFilters) {
  return Boolean(filters.teacher || filters.subject || filters.mode !== "all");
}

function countVisibleCompetencies(rows: AdminCompetencyMatrixRow[], mode: ViewMode) {
  return rows.reduce(
    (sum, row) =>
      sum + row.subject_states.filter((state) => state.has_competency && stateMatchesMode(state, mode)).length,
    0
  );
}

export default async function AdminCompetenciesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const { teachers, subjects, competencies, matrix_subjects, matrix_rows, issues } = await getAdminCompetenciesData();

  const teacherNeedle = normalize(filters.teacher);
  const subjectNeedle = normalize(filters.subject);
  const teacherFilteredRows = matrix_rows.filter((row) => teacherMatches(row.teacher, teacherNeedle));
  const subjectCandidates = matrix_subjects.filter((subject) => subjectMatches(subject, subjectNeedle));
  const candidateSubjectIds = new Set(subjectCandidates.map((subject) => subject.id));
  const matchingSubjectIds = new Set<string>();

  teacherFilteredRows.forEach((row) => {
    row.subject_states.forEach((state) => {
      if (candidateSubjectIds.has(state.subject_id) && stateMatchesMode(state, filters.mode)) {
        matchingSubjectIds.add(state.subject_id);
      }
    });
  });

  const filteredSubjects =
    filters.mode === "all" ? subjectCandidates : subjectCandidates.filter((subject) => matchingSubjectIds.has(subject.id));
  const filteredSubjectIds = new Set(filteredSubjects.map((subject) => subject.id));
  const filteredRows = teacherFilteredRows
    .map((row): AdminCompetencyMatrixRow => ({
      ...row,
      subject_states: row.subject_states.filter((state) => filteredSubjectIds.has(state.subject_id))
    }))
    .filter(
      (row) =>
        filteredSubjects.length > 0 &&
        (filters.mode === "all" || row.subject_states.some((state) => stateMatchesMode(state, filters.mode)))
    );
  const filteredTeacherIds = new Set(filteredRows.map((row) => row.teacher.id));
  const filteredCompetencies =
    filters.mode === "without_competence"
      ? []
      : competencies.filter(
          (competency) =>
            filteredTeacherIds.has(competency.teacher_id) && filteredSubjectIds.has(competency.course_subject_id)
        );
  const competenciesShown = countVisibleCompetencies(filteredRows, filters.mode);

  return (
    <>
      <PageHeader title="Admin: lærerkompetencer" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Dette er første sikre fundament for redigering af lærerkompetencer. Siden er read-only: checkboxene er kun en
        forhåndsvisning af den kommende redigeringsform, og der findes ingen gem-knapper eller aktive write actions.
      </section>

      <form action="/admin/kompetencer" className="filter-bar" method="get">
        <label>
          Lærer
          <input
            defaultValue={filters.teacher}
            list="teacher-filter-options"
            name="teacher"
            placeholder="Initialer eller navn"
            type="search"
          />
        </label>
        <datalist id="teacher-filter-options">
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacherLabel(teacher)} />
          ))}
        </datalist>

        <label>
          Fag
          <input defaultValue={filters.subject} list="subject-filter-options" name="subject" placeholder="Fagnavn" type="search" />
        </label>
        <datalist id="subject-filter-options">
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.name} />
          ))}
        </datalist>

        <label>
          Visningstype
          <select defaultValue={filters.mode} name="mode">
            {modeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button type="submit">Filtrer</button>
        {hasActiveFilters(filters) ? (
          <Link className="filter-reset" href="/admin/kompetencer">
            Nulstil
          </Link>
        ) : null}
      </form>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Lærere vist</span>
          <strong>{filteredRows.length}</strong>
        </div>
        <div className="metric-card">
          <span>Fag vist</span>
          <strong>{filteredSubjects.length}</strong>
        </div>
        <div className="metric-card">
          <span>Kompetencer vist</span>
          <strong>{competenciesShown}</strong>
        </div>
      </div>

      <section className="info-box">
        Senere writes skal ske server-side med Supabase Auth, rollecheck og audit-log i <code>data_change_log</code>.
        Frontend må fortsat kun bruge public/anon key.
      </section>

      <h2>Kompetencematrix</h2>
      <div className="table-wrap competency-table-wrap">
        <table className="competency-matrix">
          <thead>
            <tr>
              <th className="competency-sticky" scope="col">
                Lærer
              </th>
              {filteredSubjects.map((subject) => (
                <th className="competency-subject" key={subject.id} scope="col" title={subject.name}>
                  {subject.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length && filteredSubjects.length ? (
              filteredRows.map((row) => {
                const statesBySubject = new Map(row.subject_states.map((state) => [state.subject_id, state]));

                return (
                  <tr key={row.teacher.id}>
                    <th className="competency-sticky competency-teacher-cell" scope="row">
                      <strong>{asText(row.teacher.initials)}</strong>
                      <small>{asText(row.teacher.display_name, "")}</small>
                    </th>
                    {filteredSubjects.map((subject) => {
                      const state = statesBySubject.get(subject.id);
                      const showState = Boolean(state && stateMatchesMode(state, filters.mode));

                      return (
                        <td className={`competency-cell${showState ? "" : " matrix-muted-cell"}`} key={subject.id}>
                          {showState && state ? (
                            <label className="checkbox-preview" title={state.subject_name}>
                              <input checked={state.has_competency} disabled readOnly type="checkbox" />
                              <span>{state.level || "-"}</span>
                            </label>
                          ) : (
                            <span aria-hidden="true">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="empty-cell" colSpan={Math.max(filteredSubjects.length + 1, 1)}>
                  Ingen rækker fundet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Lærere</h2>
      <DataTable
        columns={["Initialer", "Navn", "Kompetencer i visning", "Pseudo-resource"]}
        rows={filteredRows.map((row) => [
          <strong key="initials">{asText(row.teacher.initials)}</strong>,
          asText(row.teacher.display_name),
          row.subject_states.filter((state) => state.has_competency && stateMatchesMode(state, filters.mode)).length,
          row.teacher.is_pseudo_resource ? "Ja" : "Nej"
        ])}
      />

      <h2>Fag</h2>
      <DataTable
        columns={["Fag", "Nøgle", "Kompetencer i visning"]}
        rows={filteredSubjects.map((subject) => [
          asText(subject.name),
          asText(subject.normalized_key),
          filteredRows.reduce((sum, row) => {
            const state = row.subject_states.find((subjectState) => subjectState.subject_id === subject.id);
            return sum + (state?.has_competency && stateMatchesMode(state, filters.mode) ? 1 : 0);
          }, 0)
        ])}
      />

      <h2>Eksisterende kompetencer</h2>
      <DataTable
        columns={["Lærer", "Fag", "Niveau", "Redigering"]}
        rows={filteredCompetencies.map((competency) => [
          asText(competency.teacher_label),
          asText(competency.subject_name),
          <span className="badge badge-info" key="level">
            {asText(competency.level)}
          </span>,
          <label className="checkbox-preview" key="edit-preview">
            <input checked disabled readOnly type="checkbox" />
            <span>Kommer senere</span>
          </label>
        ])}
      />
    </>
  );
}
