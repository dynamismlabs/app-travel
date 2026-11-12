/**
 * The contract assistants see: dist/contract.json and MCP's tool list are
 * built from these same definitions by the kit (its own tests compare the
 * two). This checks what Travel promises in them.
 */
import { describe, expect, it } from "vitest";
import { actionContract } from "@app-builder/core";
import { application } from "../src/app.js";
import * as s from "../src/actions/schemas.js";
import * as ex from "../src/actions/examples.js";

const contract = actionContract({ ...application, viewHTML: "<html></html>" });
const tools = contract.mcp.tools as { name: string; description: string; _meta?: Record<string, unknown>; annotations: Record<string, boolean> }[];

describe("contract", () => {
  it("offers Travel's data tools, its cards and open_travel to assistants", () => {
    const names = tools.map((tool) => tool.name);
    for (const name of ["list_trips", "get_trip", "save_trip", "list_bookings", "get_booking", "save_booking", "delete_booking", "list_ideas", "save_idea", "compare_ideas", "list_review_items", "review_change", "dismiss_gap", "create_follow_up", "list_follow_ups", "check_follow_up", "preview_import", "apply_import", "get_evidence", "export_trip", "open_view", "describe_view_context", "remember_view", "list_sources", "check_accounts", "setup_source", "list_calendars", "pause_source", "delete_source_data", "continue_import", "save_settings", "show_trip", "show_trips", "show_review", "open_travel"])
      expect(names).toContain(name);
    expect(tools.length).toBeLessThanOrEqual(100);
    // Tool names follow Claude's rules.
    for (const name of names) expect(name).not.toMatch(/__|\.\.|\._|_\./);
  });

  it("keeps the jobs' own actions off MCP, and declares its jobs, hub tools and purpose", () => {
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain("sync_sources");
    expect(names).not.toContain("retry_follow_ups");
    expect(contract.jobs).toEqual([
      { name: "sync_sources", title: "Import from Gmail and Calendar", schedule: "every 5 minutes", action: "sync_sources" },
      { name: "follow_ups", title: "Add approved follow-ups to Ri", schedule: "every 5 minutes", action: "retry_follow_ups" },
    ]);
    expect(contract.connectors).toMatchObject({ capabilities: ["mail.read", "calendar.read"] });
    expect(contract.connectors!.tools).toEqual(expect.arrayContaining(["gmail__read_message", "gmail__list_history", "gmail__get_attachment", "google_calendar__sync_events", "ri__create_task", "ri__get_task", "ri__ai_text", "ri__extract_text"]));
  });

  it("marks reads read-only and deletes destructive, and draws cards only from show_* and open_travel", () => {
    const tool = (name: string) => tools.find((item) => item.name === name)!;
    expect(tool("get_trip").annotations.readOnlyHint).toBe(true);
    expect(tool("save_booking").annotations.readOnlyHint).toBe(false);
    expect(tool("delete_booking").annotations.destructiveHint).toBe(true);
    expect(tool("delete_source_data").annotations.destructiveHint).toBe(true);
    for (const name of ["show_trip", "show_trips", "show_review", "open_travel"]) expect(tool(name)._meta?.["openai/outputTemplate"]).toBe("ui://travel/main");
    expect(tool("list_trips")._meta?.["openai/outputTemplate"]).toBeUndefined();
  });

  it("uses copy without long dashes or semicolons in descriptions", () => {
    for (const item of [...tools, ...contract.actions]) {
      expect(item.description).not.toMatch(/[—–]/);
      expect(item.description).not.toContain(";");
    }
  });

  it("keeps the fictional examples valid against the schemas", () => {
    expect(() => s.tripSchema.parse(ex.exampleTrip)).not.toThrow();
    expect(() => s.bookingSchema.parse(ex.exampleHotel)).not.toThrow();
    expect(() => s.bookingSchema.parse(ex.exampleFlight)).not.toThrow();
    expect(() => s.ideaSchema.parse(ex.exampleIdea)).not.toThrow();
    expect(() => s.reviewItemSchema.parse(ex.exampleReview)).not.toThrow();
    expect(() => s.followUpSchema.parse(ex.exampleFollowUp)).not.toThrow();
    expect(() => s.tripDetailSchema.parse(ex.exampleDetail)).not.toThrow();
    expect(() => s.sourceAccountSchema.parse(ex.exampleSourceAccount)).not.toThrow();
    expect(() => s.stepOutput.parse(ex.exampleStep)).not.toThrow();
  });
});
