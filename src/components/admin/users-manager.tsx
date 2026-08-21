"use client";

import * as React from "react";
import {
  AlertTriangle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  UserMinus,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { parseError } from "@/lib/errors";
import { useList, useQuery } from "@/lib/hooks";
import {
  ADMIN_PAGE_SIZE,
  fetchAssignmentsForUsers,
  fetchProfilesPage,
  fetchVessels,
  findProfileByEmail,
  type ProfileSearch,
} from "@/lib/queries";
import type {
  ProfileRow,
  SoftDuplicateRow,
  UserRole,
} from "@/lib/database.types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ActiveBadge, RoleBadge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/data-state";
import { Table, TableWrapper, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { calculateAge } from "@/lib/utils";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", description: "Fleet-wide management" },
  { value: "captain", label: "Captain", description: "One active command" },
  { value: "crew", label: "Crew", description: "May serve several vessels" },
];

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

// Crew keeps the MLC 2006 (Regulation 1.1) floor of 16; Admin and Captain — both
// command/authority roles — require 18.
const MIN_AGE_BY_ROLE: Record<UserRole, number> = {
  admin: 18,
  captain: 18,
  crew: 16,
};

/** Latest birth date that still meets the minimum age today — caps the date picker. */
function latestAllowedDob(minAge: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - minAge);
  return d.toISOString().slice(0, 10);
}

interface FormState {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  role: UserRole;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  role: "crew",
};

export function UsersManager() {
  const { toast } = useToast();
  const [showInactive, setShowInactive] = React.useState(true);

  const [searchName, setSearchName] = React.useState("");
  const [searchEmail, setSearchEmail] = React.useState("");
  const [searchPhone, setSearchPhone] = React.useState("");
  const [search, setSearch] = React.useState<ProfileSearch>({});

  React.useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setSearch({
          name: searchName.trim(),
          email: searchEmail.trim(),
          phone: searchPhone.trim(),
        }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [searchName, searchEmail, searchPhone]);

  const searchKey = JSON.stringify(search);
  const hasSearch = Boolean(search.name || search.email || search.phone);

  // The table grows from the top rather than paging: "Load more" raises this
  // limit and the query returns rows 0..limit-1 in one request. Changing the
  // filters collapses it back — adjusted during render rather than in an
  // effect, so there is no extra paint showing a stale, over-long list.
  const [limit, setLimit] = React.useState(ADMIN_PAGE_SIZE);
  const filterKey = `${showInactive}|${searchKey}`;
  const [renderedFilterKey, setRenderedFilterKey] = React.useState(filterKey);
  if (filterKey !== renderedFilterKey) {
    setRenderedFilterKey(filterKey);
    setLimit(ADMIN_PAGE_SIZE);
  }

  const usersQuery = useQuery([showInactive, limit, searchKey], () =>
    fetchProfilesPage({ includeInactive: showInactive, limit, search }),
  );
  const vesselsQuery = useQuery([], () => fetchVessels(true));

  const loadedUsers = React.useMemo(
    () => usersQuery.data?.rows ?? [],
    [usersQuery.data],
  );
  const totalUsers = usersQuery.data?.total ?? 0;
  const loadedUserIds = loadedUsers.map((user) => user.id).join(",");

  // Only the people actually on screen need their vessel assignments resolved.
  const assignmentsQuery = useQuery([loadedUserIds], () =>
    fetchAssignmentsForUsers(loadedUserIds ? loadedUserIds.split(",") : []),
  );

  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [duplicates, setDuplicates] = React.useState<SoftDuplicateRow[] | null>(
    null,
  );
  const [duplicateWarningOpen, setDuplicateWarningOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  function touch(field: string) {
    setTouched((state) => ({ ...state, [field]: true }));
  }

  const vesselNames = React.useMemo(
    () =>
      new Map(
        (vesselsQuery.data ?? []).map((vessel) => [vessel.id, vessel.name]),
      ),
    [vesselsQuery.data],
  );

  const vesselsByUser = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const assignment of assignmentsQuery.data ?? []) {
      if (!assignment.active) continue;
      const list = map.get(assignment.user_id) ?? [];
      list.push(vesselNames.get(assignment.vessel_id) ?? "Unknown vessel");
      map.set(assignment.user_id, list);
    }
    return map;
  }, [assignmentsQuery.data, vesselNames]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setDuplicates(null);
    setDuplicateWarningOpen(false);
    setTouched({});
    setOpen(true);
  }

  function openEdit(user: ProfileRow) {
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
      dateOfBirth: user.date_of_birth ?? "",
      role: user.role,
    });
    setDuplicates(null);
    setDuplicateWarningOpen(false);
    setTouched({});
    setOpen(true);
  }

  function refreshAll() {
    usersQuery.refresh();
    assignmentsQuery.refresh();
  }

  /**
   * Tier 2 of the duplicate check (§4.1): date of birth + name + phone all
   * matching an existing active user is a warning, not a block — two
   * different people can legitimately share all three.
   */
  async function findSoftDuplicates(): Promise<SoftDuplicateRow[]> {
    if (!form.dateOfBirth) return [];
    const { data, error } = await supabase.rpc("admin_find_soft_duplicates", {
      p_name: form.name,
      p_phone: form.phone,
      p_dob: form.dateOfBirth,
      p_exclude_id: form.id,
    });
    if (error || !data) return [];
    return data;
  }

  async function persist() {
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      dateOfBirth: form.dateOfBirth || null,
      role: form.role,
    };

    if (form.id) {
      await apiFetch(`/api/admin/users/${form.id}`, {
        method: "PATCH",
        json: payload,
      });
      toast({ tone: "success", title: "User updated" });
    } else {
      await apiFetch("/api/admin/users", { method: "POST", json: payload });
      toast({
        tone: "success",
        title: "User created",
        body: "They can be selected in the Identity Bar straight away.",
      });
    }

    setOpen(false);
    setDuplicates(null);
    setDuplicateWarningOpen(false);
    refreshAll();
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      const found = await findSoftDuplicates();
      if (found.length > 0) {
        setDuplicates(found);
        setDuplicateWarningOpen(true);
        return;
      }
      await persist();
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not save",
        body: parseError(caught).message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function proceedAnyway() {
    setDuplicateWarningOpen(false);
    setSaving(true);
    try {
      await persist();
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not save",
        body: parseError(caught).message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function setActive(user: ProfileRow, active: boolean) {
    setBusyId(user.id);
    try {
      const { error } = await supabase.rpc("admin_set_user_active", {
        p_user_id: user.id,
        p_active: active,
      });
      if (error) throw error;
      toast({
        tone: "success",
        title: active ? `${user.name} reactivated` : `${user.name} deactivated`,
      });
      refreshAll();
    } catch (caught) {
      const error = parseError(caught);
      toast({
        tone: error.kind === "BLOCKED" ? "conflict" : "error",
        title:
          error.kind === "BLOCKED"
            ? "Guardrail stopped that"
            : "Could not update",
        body: error.message,
      });
    } finally {
      setBusyId(null);
    }
  }

  const users = useList(loadedUsers);

  const emailValid = EMAIL_REGEX.test(form.email.trim());

  /**
   * Checked against the database rather than the rows on screen. The table is
   * only partly loaded now, so an in-memory scan would miss a clash further
   * down the list — the unique index would still refuse the write, but the
   * admin would not find out until after pressing save.
   */
  const [debouncedEmail, setDebouncedEmail] = React.useState("");
  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedEmail(form.email.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [form.email]);

  const emailSettled = debouncedEmail === form.email.trim();
  const emailDuplicateQuery = useQuery(
    [debouncedEmail, form.id],
    () => findProfileByEmail(debouncedEmail, form.id),
    { enabled: open && emailValid && emailSettled && debouncedEmail.length > 0 },
  );
  const emailDuplicate = emailDuplicateQuery.data ?? null;
  /** True while the typed value has not been looked up yet. */
  const emailChecking =
    open &&
    emailValid &&
    form.email.trim().length > 0 &&
    (!emailSettled || emailDuplicateQuery.loading);

  const phoneValid =
    form.phone === "" || (form.phone.length >= 11 && form.phone.length <= 20); // telephone and mobile phone

  const minAge = MIN_AGE_BY_ROLE[form.role];
  const age = calculateAge(form.dateOfBirth);
  const dobValid = age !== null && age >= minAge;

  const emailError =
    touched.email && form.email.trim() === ""
      ? "Email is required."
      : touched.email && !emailValid
        ? "Enter a valid email address (e.g. name@example.com)."
        : touched.email && emailDuplicate
          ? `This email is already used by ${emailDuplicate.name}.`
          : null;
  const phoneError =
    touched.phone && !phoneValid ? "Enter only 11 to 20 digits." : null;
  const dobError =
    touched.dateOfBirth && form.dateOfBirth === ""
      ? "Date of birth is required."
      : touched.dateOfBirth && !dobValid
        ? `Must be at least ${minAge} years old for the ${form.role} role.`
        : null;

  const valid =
    form.name.trim().length >= 2 &&
    emailValid &&
    !emailDuplicate &&
    // Hold Save shut while the lookup is in flight, so a duplicate cannot slip
    // through in the gap between typing and the answer coming back.
    !emailChecking &&
    phoneValid &&
    dobValid;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="size-3.5 accent-hull-700"
            />
            Show deactivated users
          </label>
          <Button onClick={openCreate}>
            <Plus /> New user
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-hull-900">
              <Search className="size-4 text-slate-400" aria-hidden />
              Search users
            </div>
            {hasSearch ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearchName("");
                  setSearchEmail("");
                  setSearchPhone("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {/* Each field takes the full width on the smallest screens, then the
              three sit side by side once there is room. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="search-name">
              <Input
                id="search-name"
                value={searchName}
                onChange={(event) => setSearchName(event.target.value)}
                placeholder="Search by name…"
                autoComplete="off"
              />
            </Field>
            <Field label="Email" htmlFor="search-email">
              <Input
                id="search-email"
                value={searchEmail}
                onChange={(event) => setSearchEmail(event.target.value)}
                placeholder="Search by email…"
                autoComplete="off"
              />
            </Field>
            <Field label="Phone" htmlFor="search-phone">
              <Input
                id="search-phone"
                value={searchPhone}
                onChange={(event) => setSearchPhone(event.target.value)}
                placeholder="Search by phone…"
                autoComplete="off"
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {usersQuery.loading && users.length === 0 ? (
          <SkeletonRows rows={5} />
        ) : usersQuery.error ? (
          <ErrorState message={usersQuery.error} />
        ) : users.length === 0 ? (
          <EmptyState title="No users yet" />
        ) : (
          <TableWrapper>
            <Table className="min-w-208">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Contact</Th>
                  <Th className="w-28">Role</Th>
                  <Th>Vessels</Th>
                  <Th className="w-24">Status</Th>
                  <Th className="w-44 text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <Tr
                    key={user.id}
                    className={user.active ? undefined : "opacity-60"}
                  >
                    <Td>
                      <p className="font-medium text-hull-900">{user.name}</p>
                      <p className="text-xs text-muted">
                        Age: {calculateAge(user.date_of_birth) ?? "—"}
                      </p>
                    </Td>
                    <Td className="text-sm">
                      <p className="break-all">{user.email}</p>
                      <p className="text-xs text-muted">{user.phone ?? "—"}</p>
                    </Td>
                    <Td>
                      <RoleBadge role={user.role} />
                    </Td>
                    <Td className="text-sm">
                      {user.role === "admin"
                        ? "Not vessel-bound"
                        : (vesselsByUser.get(user.id)?.join(", ") ?? "—")}
                    </Td>
                    <Td>
                      <ActiveBadge active={user.active} />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openEdit(user)}
                        >
                          <Pencil /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant={user.active ? "danger" : "secondary"}
                          loading={busyId === user.id}
                          onClick={() => void setActive(user, !user.active)}
                        >
                          {user.active ? <UserMinus /> : <RotateCcw />}
                          {user.active ? "Deactivate" : "Restore"}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
        )}

        {users.length < totalUsers ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-3">
            <span className="text-xs text-muted">
              Showing {users.length} of {totalUsers} users
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={usersQuery.loading}
              onClick={() => setLimit((current) => current + ADMIN_PAGE_SIZE)}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={form.id ? "Edit user" : "New user"}
          description="Create a new user account." // Every user gets a hidden backing auth account, which is what makes their permissions real rather than cosmetic.
        >
          <div className="flex flex-col gap-4">
            <Field
              label="Full name"
              required
              htmlFor="user-name"
              hint="Enter your complete name"
            >
              <Input
                id="user-name"
                value={form.name}
                onChange={(event) =>
                  setForm((state) => ({ ...state, name: event.target.value }))
                }
                autoComplete="off"
              />
            </Field>

            <Field
              label="Email"
              required
              htmlFor="user-email"
              error={emailError}
              hint="Enter your email address"
            >
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((state) => ({
                    ...state,
                    email: event.target.value.toLowerCase(),
                  }))
                }
                onBlur={() => touch("email")}
                autoComplete="off"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Phone"
                htmlFor="user-phone"
                error={phoneError}
                hint="Enter your telephone or mobile number"
              >
                <Input
                  id="user-phone"
                  type="tel"
                  inputMode="tel"
                  maxLength={20}
                  value={form.phone}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      phone: event.target.value
                        .replace(/[^0-9+\s]/g, "")
                        .replace(/\s{2,}/g, " ")
                        .slice(0, 20),
                    }))
                  }
                  onBlur={() => touch("phone")}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Date of birth"
                required
                htmlFor="user-dob"
                error={dobError}
                hint={`Must be at least ${minAge} y.o. for the ${form.role} role.`}
              >
                <Input
                  id="user-dob"
                  type="date"
                  max={latestAllowedDob(minAge)}
                  value={form.dateOfBirth}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      dateOfBirth: event.target.value,
                    }))
                  }
                  onBlur={() => touch("dateOfBirth")}
                />
              </Field>
            </div>

            <Field
              label="Role"
              required
              hint="Exactly one role per user — Admin, Captain and Crew are mutually exclusive."
            >
              <Select
                value={form.role}
                onValueChange={(next) =>
                  setForm((state) => ({ ...state, role: next as UserRole }))
                }
                options={ROLE_OPTIONS}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={!valid}
              onClick={() => void handleSubmit()}
            >
              {form.id ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={duplicateWarningOpen}
        onOpenChange={setDuplicateWarningOpen}
      >
        <DialogContent
          title="Possible duplicate"
          description="An active user already matches this date of birth, name and phone. Two different people can legitimately share those — review before continuing."
          size="sm"
        >
          <div className="flex flex-col gap-3">
            {(duplicates ?? []).map((duplicate) => (
              <div
                key={duplicate.id}
                className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-900">
                  <p className="font-medium">{duplicate.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <RoleBadge role={duplicate.role} />
                    <span>
                      {duplicate.role === "admin"
                        ? "Not vessel-bound"
                        : (vesselsByUser.get(duplicate.id)?.join(", ") ??
                          "No vessel assigned")}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-amber-700">
                    Matched on:{" "}
                    {[
                      duplicate.matched_dob_name_phone ? "Date of birth" : null,
                      duplicate.matched_dob_name_phone ? "Name" : null,
                      duplicate.matched_dob_name_phone ? "Phone" : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDuplicateWarningOpen(false)}
            >
              Return
            </Button>
            <Button
              variant="danger"
              loading={saving}
              onClick={() => void proceedAnyway()}
            >
              Proceed anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
