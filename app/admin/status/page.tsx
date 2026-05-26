import { PageHeader } from "../../../components/PageHeader";
import { AdminStatusClient } from "./AdminStatusClient";

export const dynamic = "force-dynamic";

export default function AdminStatusPage() {
  return (
    <>
      <PageHeader title="Admin status" />
      <AdminStatusClient />
    </>
  );
}
