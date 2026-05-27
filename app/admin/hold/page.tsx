import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { getAdminHoldsData } from "../../../lib/adminHoldsData";
import { AdminHoldsClient } from "./AdminHoldsClient";

export const dynamic = "force-dynamic";

export default async function AdminHoldsPage() {
  const { holds, schools, campuses, categories, programs, schema, issues } = await getAdminHoldsData();

  return (
    <>
      <PageHeader title="Admin: hold" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Hold redigeres i <code>class_groups</code> som stamdata. Fag og campus-specifikke fag hører ikke hjemme her:
        fagkataloget ligger i <code>course_subjects</code>, mens konkrete fagudbud senere kobler hold og fag sammen.
        Nuværende <code>subject_offerings</code> har én <code>class_group_id</code>; sammenlæsning mellem flere hold kræver
        en senere udvidelse af fagudbud/undervisningsgruppe-modellen.
      </section>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Hold</span>
          <strong>{holds.length}</strong>
        </div>
        <div className="metric-card">
          <span>Aktive hold</span>
          <strong>{holds.filter((hold) => hold.is_active).length}</strong>
        </div>
        <div className="metric-card">
          <span>Fagudbud</span>
          <strong>{holds.reduce((sum, hold) => sum + hold.subject_offerings_count, 0)}</strong>
        </div>
        <div className="metric-card">
          <span>Holdkrav</span>
          <strong>{holds.reduce((sum, hold) => sum + hold.requirement_count, 0)}</strong>
        </div>
      </div>

      <section className="content-section">
        <h2>Datamodel</h2>
        <dl className="definition-grid">
          <div>
            <dt>Tabel</dt>
            <dd>{schema.table}</dd>
          </div>
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
            <dt>Lifecycle</dt>
            <dd>{schema.supports_deactivation ? schema.deactivation_field : "Kræver migration 019"}</dd>
          </div>
          <div>
            <dt>Sammenlæsning</dt>
            <dd>Senere fagudbud/undervisningsgruppe-model</dd>
          </div>
        </dl>
      </section>

      <AdminHoldsClient
        campuses={campuses}
        categories={categories}
        holds={holds}
        programs={programs}
        schema={schema}
        schools={schools}
      />
    </>
  );
}
