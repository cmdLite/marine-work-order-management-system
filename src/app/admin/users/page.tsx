import { PageHeader, RequireAdmin } from "@/components/guards";
import { UsersManager } from "@/components/admin/users-manager";

export const metadata = { title: "Users · Marine Ops" };

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="Users"
        description="Create, edit and deactivate people. One role each — Admin, Captain or Crew — with the deactivation guardrails enforced in the database."
      />
      <RequireAdmin>
        <UsersManager />
      </RequireAdmin>
    </>
  );
}
