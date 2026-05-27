import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { getAdminCourseSubjectsData } from "../../../lib/adminCourseSubjectsData";
import { AdminCourseSubjectsClient } from "./AdminCourseSubjectsClient";

export const dynamic = "force-dynamic";

export default async function AdminCourseSubjectsPage() {
  const { subjects, schools, schema, issues } = await getAdminCourseSubjectsData();

  return (
    <>
      <PageHeader title="Admin: fag" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Fag redigeres i <code>course_subjects</code>. Schemaet har navn og normaliseret nøgle, men ingen
        kategori-, niveau- eller programfelter på selve fagtabellen. Når migration 018 er kørt, bruger siden
        <code>is_active</code> og arkivfelter til soft deaktivering uden hard delete.
      </section>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Fag</span>
          <strong>{subjects.length}</strong>
        </div>
        <div className="metric-card">
          <span>Kompetencer</span>
          <strong>{subjects.reduce((sum, subject) => sum + subject.competency_count, 0)}</strong>
        </div>
        <div className="metric-card">
          <span>Fagudbud</span>
          <strong>{subjects.reduce((sum, subject) => sum + subject.offering_count, 0)}</strong>
        </div>
        <div className="metric-card">
          <span>Fagkrav</span>
          <strong>{subjects.reduce((sum, subject) => sum + subject.requirement_count, 0)}</strong>
        </div>
      </div>

      <section className="content-section">
        <h2>Datamodel</h2>
        <dl className="definition-grid">
          <div>
            <dt>Fundne felter</dt>
            <dd>{schema.found_fields.join(", ")}</dd>
          </div>
          <div>
            <dt>Redigerbare felter</dt>
            <dd>{schema.editable_fields.join(", ")}</dd>
          </div>
          <div>
            <dt>Relationer</dt>
            <dd>{schema.related_tables.join(", ")}</dd>
          </div>
          <div>
            <dt>Deaktivering</dt>
            <dd>{schema.supports_deactivation ? schema.deactivation_field : "Kræver migration"}</dd>
          </div>
        </dl>
      </section>

      <AdminCourseSubjectsClient schema={schema} schools={schools} subjects={subjects} />
    </>
  );
}
