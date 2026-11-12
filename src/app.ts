import { z } from "zod/v3";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { defineAction, defineView, type Application } from "@app-builder/core";
import { appConfig } from "../app.config";
import { books } from "./schema";

const status = z.enum(["want-to-read", "reading", "finished"]);
const book = z.object({
  id: z.string(), userId: z.string(), title: z.string(), author: z.string(),
  status, note: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
const statusLabels = { "want-to-read": "want to read", reading: "reading", finished: "finished" } as const;
const fields = {
  title: z.string().trim().min(1).max(240),
  author: z.string().trim().max(160).default(""),
  status: status.default("want-to-read"),
  note: z.string().max(12000).default(""),
};

export const application: Application = {
  config: appConfig,
  // Render tools: the model reads with list_books and calls these when the person should see books.
  views: [
    defineView({
      name: "show_books", title: "Show books",
      description: "Show the person books from their reading log in an interactive card, where they can change a book's status and open the whole log. Pass ids to show particular books (ones you just added, found or changed), or filter by status. Use it when seeing the books helps the person. To read books yourself, use list_books.",
      input: z.object({
        title: z.string().max(80).optional().describe('A short heading, such as "Reading now" or "Added to your log".'),
        ids: z.array(z.string().uuid()).max(50).optional().describe("Show exactly these books, in this order."),
        status: status.optional().describe("Without ids: only books with this status."),
        limit: z.number().int().min(1).max(50).default(12).describe("Without ids: how many to show, newest first."),
      }),
      output: z.object({ title: z.string(), books: z.array(book), more: z.boolean() }),
      invoking: "Getting your books", invoked: "Your books",
      handler: async (ctx, input) => {
        const mine = eq(books.userId, ctx.viewer.id);
        const rows = input.ids?.length
          ? (await ctx.platform.db.select().from(books).where(and(mine, inArray(books.id, input.ids))))
            .sort((a, b) => input.ids!.indexOf(a.id) - input.ids!.indexOf(b.id))
          : await ctx.platform.db.select().from(books).where(and(mine, input.status ? eq(books.status, input.status) : undefined))
            .orderBy(desc(books.createdAt)).limit(input.limit + 1);
        const more = !input.ids?.length && rows.length > input.limit;
        const shown = more ? rows.slice(0, input.limit) : rows;
        const list = shown.slice(0, 10).map((book) => `${book.title} (${statusLabels[book.status as keyof typeof statusLabels] ?? book.status})`).join("; ");
        return {
          summary: shown.length ? `Showed ${shown.length}${more ? "+" : ""} ${shown.length === 1 ? "book" : "books"}: ${list}${shown.length > 10 ? "; …" : ""}.` : "No books match, so the card says so.",
          data: { title: input.title ?? (input.status ? `${statusLabels[input.status][0].toUpperCase()}${statusLabels[input.status].slice(1)}` : "Your books"), books: shown, more },
        };
      },
    }),
  ],
  async exportData(ctx) {
    return { records: { books: await ctx.platform.db.select().from(books).where(eq(books.userId, ctx.viewer.id)) } };
  },
  migrations: [{
    id: "app-0001",
    sql: `CREATE TABLE books (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, author TEXT NOT NULL, status TEXT NOT NULL,
      note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      -- statement-breakpoint
      CREATE INDEX books_owner_date_idx ON books(user_id, created_at DESC);`,
  }],
  actions: [
    defineAction({
      name: "list_books", title: "Your books", description: "List this person's reading log, newest first.",
      input: z.object({ status: status.optional(), limit: z.number().int().min(1).max(100).default(60) }),
      output: z.array(book), effect: "read", retry: "safe", audience: ["user", "agent"],
      handler: async (ctx, input) => ctx.platform.db.select().from(books).where(and(
        eq(books.userId, ctx.viewer.id), input.status ? eq(books.status, input.status) : undefined,
      )).orderBy(desc(books.createdAt)).limit(input.limit),
    }),
    defineAction({
      name: "save_book", title: "Add a book", description: "Add a book to the reading log. Keep the same id when retrying a save.",
      input: z.object({ id: z.string().uuid(), ...fields }),
      output: book, effect: "write", retry: "safe", audience: ["user", "agent"],
      handler: async (ctx, input) => {
        const [existing] = await ctx.platform.db.select().from(books).where(eq(books.id, input.id));
        if (existing) {
          if (existing.userId !== ctx.viewer.id) throw new TRPCError({ code: "CONFLICT", message: "Choose a new record ID." });
          return existing;
        }
        const timestamp = new Date().toISOString();
        const record = { ...input, userId: ctx.viewer.id, createdAt: timestamp, updatedAt: timestamp };
        await ctx.platform.db.insert(books).values(record).onConflictDoNothing();
        const [saved] = await ctx.platform.db.select().from(books).where(and(eq(books.id, input.id), eq(books.userId, ctx.viewer.id)));
        if (!saved) throw new TRPCError({ code: "CONFLICT", message: "Choose a new record ID." });
        return saved;
      },
    }),
    defineAction({
      name: "update_book", title: "Update a book", description: "Update a book's reading status or notes. Use its current updatedAt value.",
      input: z.object({ id: z.string().uuid(), expectedUpdatedAt: z.string().datetime(), ...fields }),
      output: book, effect: "write", retry: "unsafe", audience: ["user", "agent"],
      handler: async (ctx, { id, expectedUpdatedAt, ...changes }) => {
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1)).toISOString();
        const [updated] = await ctx.platform.db.update(books).set({ ...changes, updatedAt }).where(and(
          eq(books.id, id), eq(books.userId, ctx.viewer.id), eq(books.updatedAt, expectedUpdatedAt),
        )).returning();
        if (!updated) throw new TRPCError({ code: "CONFLICT", message: "This book changed. Refresh it before saving." });
        return updated;
      },
    }),
  ],
};
