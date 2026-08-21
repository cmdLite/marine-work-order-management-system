/**
 * Seeds the demo fleet.
 *
 *   npm run db:seed          # idempotent — safe to run repeatedly
 *   npm run db:reset         # wipe seeded rows and their auth accounts first
 *
 * Requires .env.local (or real environment variables):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, IMPERSONATION_SECRET
 *
 * Every person gets a hidden Supabase Auth account whose credential is derived
 * from IMPERSONATION_SECRET, which is exactly what the Identity Bar signs in as.
 * Change that secret and you must re-seed.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type {
  Database,
  UserRole,
  WorkOrderStatus,
} from "../src/lib/database.types";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.IMPERSONATION_SECRET;

if (!url || !serviceRoleKey || !secret) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or IMPERSONATION_SECRET.\n" +
      "Copy .env.example to .env.local and fill it in first.",
  );
  process.exit(1);
}

function deriveAccountPassword(email: string): string {
  const digest = createHash("sha256")
    .update(`${secret}:${email.trim().toLowerCase()}`)
    .digest("base64url");
  return `Mw1!${digest.slice(0, 40)}`;
}

const db = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SEED_TAG = "marine-ops-seed";

interface SeedVessel {
  key: string;
  name: string;
  imo_number: string | null;
  mmsi: string | null;
  flag_state: string;
}

interface SeedPerson {
  key: string;
  name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  role: UserRole;
  vessels: string[];
}

interface SeedWorkOrder {
  vessel: string;
  title: string;
  issue: string;
  captain: string;
  crew: string;
  /** How far along the Open → In Progress → Done → attested pipeline to take it. */
  stage: "open" | "in_progress" | "done" | "attested" | "rejected_once";
  solution?: string;
  rejection?: string;
}

const VESSELS: SeedVessel[] = [
  {
    key: "northern-star",
    name: "MV Northern Star",
    imo_number: "9074729",
    mmsi: "215234000",
    flag_state: "Malta",
  },
  {
    key: "coral-dawn",
    name: "MV Coral Dawn",
    imo_number: "9316245",
    mmsi: "353691000",
    flag_state: "Panama",
  },
  {
    key: "pelican",
    name: "Harbour Tender Pelican",
    imo_number: null, // under 100 GT — no IMO, so the fallback key applies
    mmsi: "232004521",
    flag_state: "United Kingdom",
  },
];

const PEOPLE: SeedPerson[] = [
  {
    key: "ines",
    name: "Inés Okonkwo",
    email: "ines.okonkwo@marineops.demo",
    phone: "+356 2122 0001",
    date_of_birth: "1982-04-11",
    role: "admin",
    vessels: [],
  },
  {
    key: "dmitri",
    name: "Dmitri Halvorsen",
    email: "dmitri.halvorsen@marineops.demo",
    phone: "+356 2122 0002",
    date_of_birth: "1978-09-23",
    role: "admin",
    vessels: [],
  },
  {
    key: "capt-mora",
    name: "Capt. Ana Mora",
    email: "ana.mora@marineops.demo",
    phone: "+356 2122 0101",
    date_of_birth: "1974-01-30",
    role: "captain",
    vessels: ["northern-star"],
  },
  {
    key: "capt-reyes",
    name: "Capt. Tomas Reyes",
    email: "tomas.reyes@marineops.demo",
    phone: "+507 6000 0102",
    date_of_birth: "1971-06-14",
    role: "captain",
    vessels: ["coral-dawn"],
  },
  {
    key: "capt-blake",
    name: "Capt. Nora Blake",
    email: "nora.blake@marineops.demo",
    phone: "+44 7700 900103",
    date_of_birth: "1985-11-02",
    role: "captain",
    vessels: ["pelican"],
  },
  {
    key: "crew-santos",
    name: "Miguel Santos",
    email: "miguel.santos@marineops.demo",
    phone: "+356 2122 0201",
    date_of_birth: "1993-03-19",
    role: "crew",
    vessels: ["northern-star"],
  },
  {
    key: "crew-adeyemi",
    name: "Funke Adeyemi",
    email: "funke.adeyemi@marineops.demo",
    phone: "+356 2122 0202",
    date_of_birth: "1990-07-08",
    role: "crew",
    // Shared across two ships — crew may hold several assignments at once.
    vessels: ["northern-star", "pelican"],
  },
  {
    key: "crew-larsen",
    name: "Erik Larsen",
    email: "erik.larsen@marineops.demo",
    phone: "+507 6000 0203",
    date_of_birth: "1988-12-01",
    role: "crew",
    vessels: ["coral-dawn"],
  },
  {
    key: "crew-nakamura",
    name: "Yui Nakamura",
    email: "yui.nakamura@marineops.demo",
    phone: "+507 6000 0204",
    date_of_birth: "1995-05-27",
    role: "crew",
    vessels: ["coral-dawn"],
  },
  {
    key: "crew-oyelaran",
    name: "Tunde Oyelaran",
    email: "tunde.oyelaran@marineops.demo",
    phone: "+44 7700 900205",
    date_of_birth: "1991-02-16",
    role: "crew",
    vessels: ["pelican"],
  },
];

const WORK_ORDERS: SeedWorkOrder[] = [
  {
    vessel: "northern-star",
    title: "Replace forward bilge pump seal",
    issue:
      "Seal is weeping in the forward bilge; the pump cycles roughly every twenty minutes and the sump is staying wet between cycles.",
    captain: "capt-mora",
    crew: "crew-santos",
    stage: "open",
  },
  {
    vessel: "northern-star",
    title: "Number 2 crane hydraulic pressure low",
    issue:
      "Crane lifts to about 60% of rated load then stalls. Suspect a leaking pressure relief valve on the port circuit.",
    captain: "capt-mora",
    crew: "crew-adeyemi",
    stage: "in_progress",
  },
  {
    vessel: "northern-star",
    title: "Galley extraction fan noise",
    issue:
      "Extraction fan above the range is grinding at high speed. Crew report the smell of hot bearing grease.",
    captain: "capt-mora",
    crew: "crew-santos",
    stage: "done",
    solution:
      "Stripped the fan housing, replaced both bearings and rebalanced the impeller. Ran for two hours at full speed with no noise and no heat at the housing.",
  },
  {
    vessel: "northern-star",
    title: "Starboard lifeboat davit seized",
    issue:
      "Davit will not swing out past 20 degrees. Last greased before the previous drydock.",
    captain: "capt-mora",
    crew: "crew-adeyemi",
    stage: "rejected_once",
    solution:
      "Freed the pivot and greased the track. Swings full travel now; load test recorded in the safety log with photographs attached.",
    rejection:
      "Freed movement is good, but I need the load test recorded in the safety log with photos before I can sign this off.",
  },
  {
    vessel: "northern-star",
    title: "Replace corroded fire hose coupling — station 4",
    issue:
      "Coupling at station 4 is badly pitted and will not seat cleanly against the hydrant.",
    captain: "capt-mora",
    crew: "crew-santos",
    stage: "attested",
    solution:
      "Fitted a new bronze coupling and gasket from ship's stores. Pressure tested at 8 bar for ten minutes, no weep.",
  },
  {
    vessel: "coral-dawn",
    title: "Auxiliary generator 2 will not hold load",
    issue:
      "Aux 2 starts and runs unloaded but trips within a minute of taking hotel load. Fuel filters were changed last week.",
    captain: "capt-reyes",
    crew: "crew-larsen",
    stage: "open",
  },
  {
    vessel: "coral-dawn",
    title: "Radar display intermittent dropout",
    issue:
      "S-band display blanks for two to three seconds at a time, several times an hour. Worse in heavy weather.",
    captain: "capt-reyes",
    crew: "crew-nakamura",
    stage: "in_progress",
  },
  {
    vessel: "coral-dawn",
    title: "Provision store refrigeration running warm",
    issue:
      "Store is sitting at +6°C against a set point of +2°C. Door seal looks sound.",
    captain: "capt-reyes",
    crew: "crew-nakamura",
    stage: "done",
    solution:
      "Condenser coil was heavily fouled. Cleaned and recharged with 400g R404A. Store pulled down to +2°C in ninety minutes and held overnight.",
  },
  {
    vessel: "pelican",
    title: "Port navigation light intermittent",
    issue:
      "Port sidelight flickers when the tender is under way. Suspect chafed cable at the deck gland.",
    captain: "capt-blake",
    crew: "crew-oyelaran",
    stage: "open",
  },
  {
    vessel: "pelican",
    title: "Fender line replacement",
    issue:
      "Three fender lines are frayed past the point of safe use after a hard week alongside.",
    captain: "capt-blake",
    crew: "crew-adeyemi",
    stage: "attested",
    solution:
      "Replaced all three lines with 16mm polyester and re-whipped the ends. Old lines cut and binned so they cannot be reused.",
  },
];

async function main() {
  const reset = process.argv.includes("--reset");

  if (reset) {
    console.log("Resetting seeded data…");
    await db.from("work_order_events").delete().not("id", "is", null);
    await db.from("work_orders").delete().not("id", "is", null);
    await db.from("vessel_assignments").delete().not("id", "is", null);

    const { data: profiles } = await db.from("profiles").select("auth_user_id");
    await db.from("profiles").delete().not("id", "is", null);
    for (const profile of profiles ?? []) {
      if (profile.auth_user_id) {
        await db.auth.admin.deleteUser(profile.auth_user_id).catch(() => undefined);
      }
    }
    await db.from("vessels").delete().not("id", "is", null);
    console.log("  cleared.");
  }

  // ---------------------------------------------------------------- vessels
  const vesselIds = new Map<string, string>();
  for (const vessel of VESSELS) {
    const { data: existing } = await db
      .from("vessels")
      .select("id")
      .eq("name", vessel.name)
      .maybeSingle();

    if (existing) {
      vesselIds.set(vessel.key, existing.id);
      continue;
    }

    const { data, error } = await db
      .from("vessels")
      .insert({
        name: vessel.name,
        imo_number: vessel.imo_number,
        mmsi: vessel.mmsi,
        flag_state: vessel.flag_state,
        active: true,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`vessel ${vessel.name}: ${error?.message}`);
    vesselIds.set(vessel.key, data.id);
    console.log(`  + vessel ${vessel.name}`);
  }

  // ---------------------------------------------------------------- people
  const profileIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const { data: existing } = await db
      .from("profiles")
      .select("id, auth_user_id")
      .eq("email", person.email)
      .maybeSingle();

    if (existing?.auth_user_id) {
      profileIds.set(person.key, existing.id);
      continue;
    }

    const { data: authUser, error: authError } = await db.auth.admin.createUser({
      email: person.email,
      password: deriveAccountPassword(person.email),
      email_confirm: true,
      user_metadata: { name: person.name, seeded_by: SEED_TAG },
    });

    if (authError || !authUser.user) {
      throw new Error(`auth account ${person.email}: ${authError?.message}`);
    }

    if (existing) {
      await db
        .from("profiles")
        .update({ auth_user_id: authUser.user.id })
        .eq("id", existing.id);
      profileIds.set(person.key, existing.id);
      continue;
    }

    const { data, error } = await db
      .from("profiles")
      .insert({
        auth_user_id: authUser.user.id,
        name: person.name,
        email: person.email,
        phone: person.phone,
        date_of_birth: person.date_of_birth,
        role: person.role,
        active: true,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`profile ${person.email}: ${error?.message}`);
    profileIds.set(person.key, data.id);
    console.log(`  + ${person.role.padEnd(7)} ${person.name}`);
  }

  // ----------------------------------------------------------- assignments
  for (const person of PEOPLE) {
    for (const vesselKey of person.vessels) {
      const userId = profileIds.get(person.key)!;
      const vesselId = vesselIds.get(vesselKey)!;

      const { data: existing } = await db
        .from("vessel_assignments")
        .select("id")
        .eq("user_id", userId)
        .eq("vessel_id", vesselId)
        .maybeSingle();

      if (existing) continue;

      const { error } = await db
        .from("vessel_assignments")
        .insert({ user_id: userId, vessel_id: vesselId, active: true });

      if (error) throw new Error(`assignment ${person.name}/${vesselKey}: ${error.message}`);
      console.log(`  + ${person.name} → ${vesselKey}`);
    }
  }

  // ----------------------------------------------------------- work orders
  const { count: existingWorkOrders } = await db
    .from("work_orders")
    .select("id", { count: "exact", head: true });

  if ((existingWorkOrders ?? 0) > 0) {
    console.log(
      `  work orders already present (${existingWorkOrders}) — skipping. Use --reset to rebuild.`,
    );
  } else {
    for (const seed of WORK_ORDERS) {
      const vesselId = vesselIds.get(seed.vessel)!;
      const captainId = profileIds.get(seed.captain)!;
      const crewId = profileIds.get(seed.crew)!;

      const targetStatus: WorkOrderStatus =
        seed.stage === "open"
          ? "open"
          : seed.stage === "in_progress" || seed.stage === "rejected_once"
            ? "in_progress"
            : "done";

      const { data: workOrder, error } = await db
        .from("work_orders")
        .insert({
          vessel_id: vesselId,
          title: seed.title,
          issue: seed.issue,
          created_by: captainId,
          assigned_crew_id: crewId,
          status: targetStatus,
          solution: seed.solution ?? null,
          attested_at: seed.stage === "attested" ? new Date().toISOString() : null,
          attested_by: seed.stage === "attested" ? captainId : null,
        })
        .select("id, code")
        .single();

      if (error || !workOrder) {
        throw new Error(`work order ${seed.title}: ${error?.message}`);
      }

      const events: {
        work_order_id: string;
        type: "created" | "assigned" | "status_change" | "attested" | "rejected";
        actor_id: string;
        note: string | null;
        from_status: WorkOrderStatus | null;
        to_status: WorkOrderStatus | null;
      }[] = [
        {
          work_order_id: workOrder.id,
          type: "created",
          actor_id: captainId,
          note: "Work order raised",
          from_status: null,
          to_status: "open",
        },
      ];

      if (seed.stage !== "open") {
        events.push({
          work_order_id: workOrder.id,
          type: "status_change",
          actor_id: crewId,
          note: "Work started",
          from_status: "open",
          to_status: "in_progress",
        });
      }

      if (seed.stage === "done" || seed.stage === "attested" || seed.stage === "rejected_once") {
        events.push({
          work_order_id: workOrder.id,
          type: "status_change",
          actor_id: crewId,
          note: "Solution documented, marked complete",
          from_status: "in_progress",
          to_status: "done",
        });
      }

      if (seed.stage === "rejected_once") {
        events.push({
          work_order_id: workOrder.id,
          type: "rejected",
          actor_id: captainId,
          note: seed.rejection ?? "Sent back for more evidence.",
          from_status: "done",
          to_status: "in_progress",
        });
      }

      if (seed.stage === "attested") {
        events.push({
          work_order_id: workOrder.id,
          type: "attested",
          actor_id: captainId,
          note: null,
          from_status: "done",
          to_status: "done",
        });
      }

      const { error: eventError } = await db.from("work_order_events").insert(events);
      if (eventError) throw new Error(`events for ${workOrder.code}: ${eventError.message}`);

      console.log(`  + ${workOrder.code} ${seed.title} (${seed.stage})`);
    }
  }

  console.log("\nSeed complete. Open the app and pick anyone from the Identity Bar.");
}

main().catch((error: unknown) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
