import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "@app-builder/core/schema";
export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  author: text("author").notNull(),
  status: text("status", { enum: ["want-to-read", "reading", "finished"] }).notNull(),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
