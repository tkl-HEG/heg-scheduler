import { DataTable } from "../../../components/DataTable";
import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { asText } from "../../../lib/format";
import { getAdminCompetenciesData } from "../../../lib/adminCompetenciesData";

export const dynamic = "force-dynamic";

export default async function AdminCompetenciesPage() {
  const { teachers, subjects, competencies, matrix_subjects, matrix_rows, issues } = await getAdminCompetenciesData();

  return (
    <>
      <PageHeader title="Admin: lærerkompetencer" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Dette er første sikre fundament for redigering af lærerkompetencer. Siden er read-only: checkboxene er kun en
        forhåndsvisning af den kommende redigeringsform, og der findes ingen gem-knapper eller aktive write actions.
      </section>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Lærere</span>
          <strong>{teachers.length}</strong>
        </div>
        <div className="metric-card">
          <span>Fag</span>
          <strong>{subjects.length}</strong>
        </div>
        <div className="metric-card">
          <span>Registrerede kompetencer</span>
          <strong>{competencies.length}</strong>
        </div>
      </div>

      <section className="info-box">
        Senere writes skal ske server-side med Supabase Auth, rollecheck og audit-log i <code>data_change_log</code>.
        Frontend må fortsat kun bruge public/anon key.
      </section>

      <h2>Kompetencematrix</h2>
      <DataTable
        columns={["Lærer", ...matrix_subjects.map((subject) => subject.name)]}
        rows={matrix_rows.map((row) => [
          <strong key="teacher">{asText(row.teacher.initials)}</strong>,
          ...row.subject_states.map((state) => (
            <label className="checkbox-preview" key={state.subject_id} title={state.subject_name}>
              <input checked={state.has_competency} disabled readOnly type="checkbox" />
              <span>{state.level || "-"}</span>
            </label>
          ))
        ])}
      />

      <h2>Lærere</h2>
      <DataTable
        columns={["Initialer", "Navn", "Kompetencer", "Pseudo-resource"]}
        rows={teachers.map((teacher) => [
          <strong key="initials">{asText(teacher.initials)}</strong>,
          asText(teacher.display_name),
          teacher.competency_count,
          teacher.is_pseudo_resource ? "Ja" : "Nej"
        ])}
      />

      <h2>Fag</h2>
      <DataTable
        columns={["Fag", "Nøgle", "Antal lærere med kompetence"]}
        rows={subjects.map((subject) => [asText(subject.name), asText(subject.normalized_key), subject.competency_count])}
      />

      <h2>Eksisterende kompetencer</h2>
      <DataTable
        columns={["Lærer", "Fag", "Niveau", "Redigering"]}
        rows={competencies.map((competency) => [
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

