/**
 * The fictional preview, in place of Ri's demo mode: Alex Rivera's trips seeded
 * into an empty installation. Nothing is read from any account. Used by
 * scripts/preview.mjs with a disposable data directory, and by tests.
 */
import type { Platform } from "@app-builder/core";
import { travelFor } from "../services/core.js";
import { seedFixtures } from "./seed.js";

export async function seedPreview(platform: Platform): Promise<string> {
  const t = travelFor({ platform });
  return seedFixtures(t) ? "Seeded Travel's fictional preview trips." : "Travel already has records, so the fictional preview wasn't added.";
}
