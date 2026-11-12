/**
 * Writes fixtures/connectors.json: the fictional mail, calendar and Ri
 * services the kit serves under APP_CONNECTORS=fixtures, for `serve --install`
 * and `change` checks and the hub tests. Run: pnpm exec tsx scripts/write-fixtures.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ConnectorFixtures } from "@app-builder/core";
import * as fx from "../src/fixtures/messages.js";

const address = (header: string) => {
  const match = /^(.*?)\s*<([^>]+)>$/.exec(header);
  return match ? { name: match[1].trim(), email: match[2].trim().toLowerCase() } : { email: header.trim().toLowerCase() };
};
const mail = (message: fx.FixtureMessage) => ({
  id: message.id, threadId: message.id, from: address(message.from), to: [{ name: "Alex Rivera", email: "alex.rivera@example.test" }], cc: [],
  subject: message.subject, date: message.receivedAt, snippet: message.text.slice(0, 160).replace(/\s+/g, " "), text: message.text, labels: ["INBOX"],
});
const fixtures: ConnectorFixtures = {
  mail: {
    messages: [
      mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL), mail(fx.LISBON_DINNER), mail(fx.PORTLAND_TRAIN), mail(fx.PORTLAND_HOTEL),
      { id: "fx-newsletter", threadId: "fx-newsletter", from: { name: "Deals", email: "offers@shop.example" }, to: [], cc: [], subject: "Autumn deals for you", date: "2026-10-10T10:00:00.000Z", snippet: "Save on sweaters this week.", text: "Save on sweaters this week.", labels: ["INBOX"] },
    ],
  },
  calendar: {
    events: [
      { id: "fx-cal-flight", title: "Flight RA 204 to Lisbon", start: "2026-11-10T00:55:00.000Z", end: "2026-11-10T08:40:00.000Z", allDay: false, status: "confirmed" },
      { id: "fx-cal-planning", title: "Quarterly planning", start: "2026-11-11T16:00:00.000Z", end: "2026-11-11T17:30:00.000Z", allDay: false, status: "confirmed" },
      { id: "fx-cal-birthday", title: "Sam's birthday dinner", start: "2026-12-05", end: "2026-12-06", allDay: true, status: "confirmed" },
    ],
  },
  tools: {
    gmail__get_profile: { result: { emailAddress: "alex.rivera@example.test", historyId: "100" } },
    ri__create_task: { approval: true },
    ri__get_task: { result: { id: "fx-task-1", title: "Fictional task" } },
    ri__extract_text: { result: { text: "Riverside House\nBooking reference: RH-4821\nGuest name: Alex Rivera\nCheck-in: Tue, Nov 10, 2026 (from 14:00)\nCheck-out: Sat, Nov 14, 2026 (until 11:00)", truncated: false, characters: 140 } },
  },
};
const file = path.resolve(import.meta.dirname, "../fixtures/connectors.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(fixtures, null, 2) + "\n");
console.log(`Wrote ${file}`);
