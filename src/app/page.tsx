import { PageHeader, RequireSession } from "@/components/guards";
import { Dashboard } from "@/components/dashboard";

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Fleet dashboard"
        description="Everything below is scoped to the identity and vessel selected in the bar above — the same data that person would see if they had logged in."
      />
      <RequireSession>
        <Dashboard />
      </RequireSession>
    </>
  );
}
