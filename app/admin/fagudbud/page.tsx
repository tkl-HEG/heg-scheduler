import { PageHeader } from "../../../components/PageHeader";
import { StatusMessage } from "../../../components/StatusMessage";
import { getAdminSubjectOfferingsData } from "../../../lib/adminSubjectOfferingsData";
import { AdminSubjectOfferingsClient } from "./AdminSubjectOfferingsClient";

export const dynamic = "force-dynamic";

export default async function AdminSubjectOfferingsPage() {
  const { offerings, schools, subjects, classGroups, schema, issues } = await getAdminSubjectOfferingsData();
  const sharedCount = offerings.filter((offering) => offering.is_shared).length;
  const inactiveCount = offerings.filter((offering) => !offering.is_active).length;

  return (
    <>
      <PageHeader title="Admin: fagudbud" />
      <StatusMessage issues={issues} />

      <section className="info-box">
        Fagudbud redigeres i <code>subject_offerings</code>. Fag kommer fra <code>course_subjects</code>, hold kommer
        fra <code>class_groups</code>, og sammenlæsning ligger i <code>subject_offering_class_groups</code>.{" "}
        <code>subject_offerings.class_group_id</code> sættes fortsat til det første valgte hold som legacy/primært hold.
      </section>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Fagudbud</span>
          <strong>{offerings.length}</strong>
        </div>
        <div className="metric-card">
          <span>Sammenlæste</span>
          <strong>{sharedCount}</strong>
        </div>
        <div className="metric-card">
          <span>Lærertildelinger</span>
          <strong>{offerings.reduce((sum, offering) => sum + offering.assignment_count, 0)}</strong>
        </div>
        <div className="metric-card">
          <span>Inaktive</span>
          <strong>{inactiveCount}</strong>
        </div>
      </div>

      <section className="content-section">
        <h2>Datamodel</h2>
        <dl className="definition-grid">
          <div>
            <dt>Felter i subject_offerings</dt>
            <dd>{schema.found_fields.join(", ")}</dd>
          </div>
          <div>
            <dt>Redigerbare felter</dt>
            <dd>{schema.editable_fields.join(", ")}</dd>
          </div>
          <div>
            <dt>Timer/periode</dt>
            <dd>
              {schema.timer_fields.join(", ")} / {schema.period_fields.join(", ")}
            </dd>
          </div>
          <div>
            <dt>Lærerrelationer</dt>
            <dd>{schema.teacher_relation_fields.join(", ")}</dd>
          </div>
          <div>
            <dt>Holdrelationer</dt>
            <dd>
              <code>{schema.join_table}</code> er sandheden for alle hold. <code>{schema.legacy_primary_field}</code> er
              legacy/primært hold.
            </dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{schema.supports_deactivation ? "is_active, archived_at, archived_by, archived_reason" : "Kræver migration 021"}</dd>
          </div>
          <div>
            <dt>Relevante views</dt>
            <dd>{schema.related_views.join(", ")}</dd>
          </div>
          <div>
            <dt>Relationer</dt>
            <dd>{schema.related_tables.join(", ")}</dd>
          </div>
        </dl>
      </section>

      <AdminSubjectOfferingsClient
        classGroups={classGroups}
        offerings={offerings}
        schema={schema}
        schools={schools}
        subjects={subjects}
      />
    </>
  );
}
