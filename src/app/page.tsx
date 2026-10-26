import { cookies } from "next/headers";
import { createClient } from "../../utils/supabase/server";
import { Dashboard } from "../features/dashboard/dashboard";

// Row shape for the subset of public.agent_roi_insights columns the
// dashboard needs. Column names are grounded in agentLoop.ts, which
// reads/writes exactly these fields (status, drift_status,
// execution_duration_ms, processed_at, roi_priority_rank,
// operational_action; name falls back to associated_entity.
// NOTE: there is no workflow_marker column in the live table (verified
// against information_schema 2026-10-26) — agentLoop.ts references it
// only as an optional fallback on an `any`-typed object.
type AgentRoiInsightRow = {
  id: string | number;
  operational_action: string | null;
  associated_entity: string | null;
  status: string | null;
  drift_status: string | null;
  execution_duration_ms: number | null;
  processed_at: string | null;
  roi_priority_rank: number | null;
};

export default async function Page() {
  const configured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!configured) {
    return (
      <Dashboard
        tasks={[]}
        taskCount={0}
        dataError="Supabase is not configured. Add the public URL and publishable key to load live tasks."
        dateLabel={getDateLabel()}
      />
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data, error, count } = await supabase
    .from("agent_roi_insights")
    .select(
      "id, operational_action, associated_entity, status, drift_status, execution_duration_ms, processed_at, roi_priority_rank",
      { count: "exact" }
    )
    // Highest-priority automation candidates first. roi_priority_rank 1 is
    // the top rank; rows without a rank sort last.
    .order("roi_priority_rank", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(6);

  const tasks = (data ?? []).map((row: AgentRoiInsightRow) => ({
    id: row.id,
    name: row.operational_action ?? row.associated_entity ?? null,
    status: row.status ?? null,
    driftStatus: row.drift_status ?? null,
    executionDurationMs: row.execution_duration_ms ?? null,
    processedAt: row.processed_at ?? null,
    roiPriorityRank: row.roi_priority_rank ?? null,
  }));

  return (
    <Dashboard
      tasks={tasks}
      taskCount={count ?? tasks.length}
      dataError={error?.message ?? null}
      dateLabel={getDateLabel()}
    />
  );
}

function getDateLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    // Was "UTC": in America/New_York the UTC date is a day ahead during
    // the evening, so the header showed tomorrow's date at demo time.
    timeZone: "America/New_York",
  }).format(new Date()).toUpperCase();
}
