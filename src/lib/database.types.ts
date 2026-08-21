/**
 * Hand-maintained mirror of the SQL in `supabase/migrations`.
 *
 * Regenerate with the Supabase CLI if you prefer:
 *   supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 */

export type UserRole = "admin" | "captain" | "crew";
export type WorkOrderStatus = "open" | "in_progress" | "done";
export type WorkOrderEventType =
  | "created"
  | "assigned"
  | "status_change"
  | "attested"
  | "rejected";

export type VesselRow = {
  id: string;
  name: string;
  imo_number: string | null;
  mmsi: string | null;
  flag_state: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileRow = {
  id: string;
  auth_user_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type VesselAssignmentRow = {
  id: string;
  user_id: string;
  vessel_id: string;
  active: boolean;
  assigned_at: string;
  unassigned_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkOrderRow = {
  id: string;
  code: string;
  vessel_id: string;
  title: string;
  issue: string;
  solution: string | null;
  status: WorkOrderStatus;
  assigned_crew_id: string;
  created_by: string;
  attested_at: string | null;
  attested_by: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkOrderExpandedRow = WorkOrderRow & {
  vessel_name: string;
  assigned_crew_name: string;
  created_by_name: string;
  attested_by_name: string | null;
};

export type WorkOrderEventRow = {
  id: string;
  work_order_id: string;
  type: WorkOrderEventType;
  actor_id: string | null;
  note: string | null;
  from_status: WorkOrderStatus | null;
  to_status: WorkOrderStatus | null;
  created_at: string;
}

export type IdentityVessel = {
  id: string;
  name: string;
}

export type IdentityMember = {
  id: string;
  name: string;
  role: UserRole;
}

export type MeRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  active: boolean;
}

export type SoftDuplicateRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  matched_dob_name_phone: boolean;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      vessels: Table<VesselRow>;
      profiles: Table<ProfileRow>;
      vessel_assignments: Table<VesselAssignmentRow>;
      work_orders: Table<WorkOrderRow>;
      work_order_events: Table<WorkOrderEventRow>;
    };
    Views: {
      work_orders_expanded: {
        Row: WorkOrderExpandedRow;
        Relationships: [];
      };
    };
    Functions: {
      me: { Args: Record<string, never>; Returns: MeRow[] };
      identity_vessels: {
        Args: { p_profile_id?: string | null };
        Returns: IdentityVessel[];
      };
      identity_members: {
        Args: { p_vessel_id?: string | null; p_role?: UserRole | null };
        Returns: IdentityMember[];
      };
      wo_create: {
        Args: {
          p_vessel_id: string;
          p_title: string;
          p_issue: string;
          p_assigned_crew_id: string;
        };
        Returns: WorkOrderRow;
      };
      wo_start: {
        Args: { p_id: string; p_expected_status: WorkOrderStatus };
        Returns: WorkOrderRow;
      };
      wo_complete: {
        Args: {
          p_id: string;
          p_solution: string;
          p_expected_status: WorkOrderStatus;
        };
        Returns: WorkOrderRow;
      };
      wo_attest: {
        Args: {
          p_id: string;
          p_expected_status: WorkOrderStatus;
          p_expected_attested: boolean;
          p_note?: string | null;
        };
        Returns: WorkOrderRow;
      };
      wo_reject: {
        Args: {
          p_id: string;
          p_reason: string;
          p_expected_status: WorkOrderStatus;
          p_expected_attested: boolean;
        };
        Returns: WorkOrderRow;
      };
      wo_reassign: {
        Args: {
          p_id: string;
          p_new_crew_id: string;
          p_expected_status: WorkOrderStatus;
        };
        Returns: WorkOrderRow;
      };
      admin_find_soft_duplicates: {
        Args: {
          p_name: string;
          p_phone: string | null;
          p_dob: string | null;
          p_exclude_id?: string | null;
        };
        Returns: SoftDuplicateRow[];
      };
      admin_create_vessel: {
        Args: {
          p_name: string;
          p_imo_number?: string | null;
          p_mmsi?: string | null;
          p_flag_state?: string | null;
        };
        Returns: VesselRow;
      };
      admin_update_vessel: {
        Args: {
          p_id: string;
          p_name: string;
          p_imo_number?: string | null;
          p_mmsi?: string | null;
          p_flag_state?: string | null;
        };
        Returns: VesselRow;
      };
      admin_set_vessel_active: {
        Args: { p_id: string; p_active: boolean };
        Returns: VesselRow;
      };
      admin_assign_vessel: {
        Args: { p_user_id: string; p_vessel_id: string };
        Returns: VesselAssignmentRow;
      };
      admin_unassign_vessel: {
        Args: { p_user_id: string; p_vessel_id: string };
        Returns: VesselAssignmentRow;
      };
      admin_set_user_active: {
        Args: { p_user_id: string; p_active: boolean };
        Returns: ProfileRow;
      };
    };
    Enums: {
      user_role: UserRole;
      work_order_status: WorkOrderStatus;
      work_order_event_type: WorkOrderEventType;
    };
    CompositeTypes: Record<string, never>;
  };
}
