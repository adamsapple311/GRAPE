# Frontend

The `src/app` directory contains the Next.js App Router entry point, layout,
and global theme. The command-center screen lives in
`src/features/dashboard`; it gets task records from the server-rendered page
and keeps dashboard-only interactions in the client component.

The server page reads the `todos` table through the existing Supabase server
client. It requests only `id` and `name`; connection and query errors are shown
in the dashboard rather than being presented as live data.

Dashboard telemetry and agent activity are marked as sample data until those
backend endpoints are available. Knobs, switches, and sliders currently change
the local preview only. Hover and click sounds are synthesized with the Web
Audio API, so no audio assets are required; use the footer sound control to mute
them.

```text
src/
  app/                       App Router page, layout, and global styles
  assets/                    Imported static assets
  components/
    layout/                  Shared page and navigation layouts
    ui/                      Reusable presentation components
  features/
    dashboard/               Command-center screen and local controls
  hooks/                     Shared UI hooks
  lib/                       Frontend utilities and integrations
  styles/                    Additional styles and theme definitions
  types/                     Shared frontend types
```

Place feature-specific code under `features/<feature>` and move components or
utilities into shared directories when they are reused.
