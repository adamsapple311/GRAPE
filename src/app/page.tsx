import { cookies } from "next/headers";
import { createClient } from "../../utils/supabase/server";
import { Dashboard } from "../features/dashboard/dashboard";

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
    .from("todos")
    .select("id, name", { count: "exact" })
    .limit(6);

  return (
    <Dashboard
      tasks={data ?? []}
      taskCount={count ?? data?.length ?? 0}
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
    timeZone: "UTC",
  }).format(new Date()).toUpperCase();
}
