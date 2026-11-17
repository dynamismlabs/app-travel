import type { AppConfig } from "@app-builder/core";
export const appConfig: AppConfig = {
  id: "travel",
  name: "Travel",
  description: "Trips, bookings, saved ideas and changes in one itinerary.",
  port: 4334,
  // Travel's writes are transactions that read (the core's transaction()), which run on Node only for now.
  platforms: ["node"],
};
