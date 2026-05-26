import { PageHeader } from "../../../components/PageHeader";
import { AuthCallbackClient } from "./AuthCallbackClient";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <>
      <PageHeader title="Auth callback" />
      <AuthCallbackClient />
    </>
  );
}
