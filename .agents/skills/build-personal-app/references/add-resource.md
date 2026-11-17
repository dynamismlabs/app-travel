# Add an observation resource

Use this as a worked slice, adapting names and fields to the requested app. These files belong to the app, not the core. Keep existing migrations unchanged.

In src/schema.ts, add a Drizzle table. Import users from the core schema:

```ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "@app-builder/core/schema";
export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
});
```

Append `app-0002` to application.migrations in src/app.ts (choose the next unused id):

```sql
CREATE TABLE observations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX observations_owner_idx ON observations(user_id, created_at DESC);
```

Define the create action in src/app.ts. Read actions filter by the same viewer id. Never accept an owner id from the browser or agent.

```ts
import { z } from "zod/v3";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { defineAction } from "@app-builder/core";
const observation = z.object({
  id: z.string(), userId: z.string(), title: z.string(),
  note: z.string(), createdAt: z.string(),
});
const saveObservation = defineAction({
  name: "save_observation", title: "Save an observation",
  description: "Record an observation. Reuse its id when retrying.",
  input: z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(240), note: z.string().max(12000).default("") }),
  output: observation, audience: ["user", "agent"], effect: "write", retry: "safe",
  handler: async (ctx, input) => {
    await ctx.platform.db.insert(observations).values({
      ...input, userId: ctx.viewer.id, createdAt: new Date().toISOString(),
    }).onConflictDoNothing();
    const [saved] = await ctx.platform.db.select().from(observations).where(and(
      eq(observations.id, input.id), eq(observations.userId, ctx.viewer.id),
    ));
    if (!saved) throw new TRPCError({ code: "CONFLICT", message: "Choose a new observation ID." });
    return saved;
  },
});
// Add saveObservation to application.actions.
```

In the React screen, call `useAppClient().save("save_observation", { id: crypto.randomUUID(), title, note })`. Add `<PendingSaves />` so failed or offline captures remain visible. Use `useAction` for the authorized list. For photos, pass stable upload IDs and File objects as the third save argument, and define application.authorizeFile by loading the observation and checking its userId. The core supplies upload, download and read_photo MCP tools.

Refuse with a message written for the person: a `TRPCError` with a code, or a plain `Error`. The browser and assistants see that message. A bug or a database or file failure is shown only as "This request could not be completed." ("Action failed." to an assistant) and goes to the server's log with its stack; callers never see a stack or a file path, whatever NODE_ENV is.

A create that keeps a client-chosen ID must not reveal someone else's record when that ID is taken: return the existing row only if this caller may read it, and otherwise refuse with a conflict that says nothing about it. With sources, pass the row's source to `existingOnRetry(ctx, row, sourceId)` from `@app-builder/core`.

Expose selected observation id/title through client.select and clear on closing it, and report the place with `client.setSection({ title, path, filters })`. If the observations have their own page (`/observations/<id>`), declare `records` on the application so `open_<app>` can open one and the host's @ menu offers them (Reading Log's `records` is the pattern: `paths`, `search` and `read`, each filtered to what the caller may see). Deleting an observation is the person's decision: give `delete_observation` `audience: ["user", "agent"], visibility: ["app"]` so the view can offer it and a host that follows MCP Apps keeps it from the model. Export only records the viewer owns through application.exportData. Build regenerates MCP tools and dist/contract.json from these action definitions: `mcp.tools` in the contract is exactly what an MCP client lists, output schemas included.

Verify one browser-created record via list_observations from MCP; create another through MCP and refresh the screen. Retry the same create id and assert one row. Apply the migration to a database already containing books, restart, and compare old IDs. A second user's list must be empty and private-photo reads must fail through both HTTP and MCP.
