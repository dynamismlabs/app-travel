/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Travel's view root. Where the screen is (section, trip, tab, day,
 * selection and filters) lives in the address: the browser's in Travel's own
 * page, memory inside an assistant. Back and Forward move it. `/`, a booking
 * and an idea are placed by the app's `open_view`.
 *
 * The selected booking (or the trip, when none is selected) reaches the
 * assistant as the kit's bounded selection: its id and title. The assistant
 * reads records through Travel's tools under its own connection.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { OpenInBrowser, useAppClient } from "@app-builder/core/react";
import { AppFrame, installStyles, LoadingState, Notice, SectionTabs, useRiApp } from "../ui/index.js";
import { AddBookingDialog } from "./add.js";
import { ReviewScreen } from "./review.js";
import { SourcesScreenView } from "./sources.js";
import { TRAVEL_CSS } from "./styles.js";
import { TripScreen } from "./trip.js";
import { TripsScreen } from "./trips.js";
import type { OpenData, Route, StatusFilter, TripTab } from "./types.js";
import { pathOf, routeFromData } from "./util.js";

interface Nav {
  route: Route;
  navigate(next: Route): void;
  /** Open the add-booking dialog, optionally for a trip. */
  addBooking(tripId?: string | null): void;
  /** Kept for the screens' calls; revisions no longer travel to the assistant. */
  setRevisions(revisions: Record<string, number>): void;
  data: OpenData;
}
const NavContext = createContext<Nav | null>(null);
export function useNav(): Nav {
  const value = useContext(NavContext);
  if (!value) throw new Error("useNav needs TravelApp");
  return value;
}

const STATUSES: StatusFilter[] = ["all", "confirmed", "planned", "canceled", "needs_review"];
/** The place an address names, or null when only the app can say (`/`, a booking or an idea). */
export function routeFromAddress(pathname: string, search: string): Route | null {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const query = new URLSearchParams(search);
  if (parts[0] === "trips" && parts[1]) {
    const tab = query.get("tab");
    const status = query.get("status") as StatusFilter | null;
    const day = query.get("day");
    return {
      section: "trip", tripId: parts[1].slice(0, 128), tab: (tab === "bookings" || tab === "ideas" ? tab : "itinerary") as TripTab,
      day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null, selected: query.get("selected")?.slice(0, 128) || null,
      status: status && STATUSES.includes(status) ? status : "all", q: query.get("q")?.slice(0, 200) ?? "",
    };
  }
  if (parts[0] === "trips") return { section: "trips" };
  if (parts[0] === "review") return { section: "review", tripId: query.get("trip") };
  if (parts[0] === "sources") return { section: "sources" };
  return null;
}

export function TravelApp() {
  const app = useRiApp<OpenData>();
  const client = useAppClient();
  const data = app.data;
  const location = useLocation();
  const [adding, setAdding] = useState<{ tripId: string | null } | null>(null);
  const remembered = useRef<string | null>(null);
  useEffect(() => {
    installStyles(TRAVEL_CSS);
  }, []);

  const named = routeFromAddress(location.pathname, location.search);
  // `/`, a booking or an idea: the app says where they lead, then the address moves there.
  const placed = !named && data && data.path === location.pathname ? routeFromData(data) : null;
  const route: Route | null = named ?? placed;
  useEffect(() => {
    if (!named && placed) app.setLocation(pathOf(placed), { replace: true });
  }, [named === null, placed && pathOf(placed)]);

  const current = useRef(route);
  current.current = route;
  const navigate = useCallback((next: Route) => {
    const before = current.current;
    const path = pathOf(next);
    // A booking opened beside the itinerary is a place Back closes, and closing it goes Back the way the person came.
    const sameTrip = before?.section === "trip" && next.section === "trip" && before.tripId === next.tripId && before.tab === next.tab;
    if (sameTrip && !before.selected && next.selected) app.setLocation(path, { push: true });
    else if (sameTrip && before.selected && !next.selected) app.goBack(path);
    else app.setLocation(path);
  }, [app]);

  // Remember the trip once per trip, not on every day or tab change.
  useEffect(() => {
    if (route?.section !== "trip" || !data?.owner || remembered.current === route.tripId) return;
    remembered.current = route.tripId;
    void app.call("remember_view", { lastTripId: route.tripId }).catch(() => undefined);
  }, [route?.section === "trip" ? route.tripId : null, data?.owner]);

  // Leaving Travel's screen clears what the assistant was told.
  useEffect(() => () => { app.select(null); app.setSection(null); }, [app.select, app.setSection]);
  // Leaving a trip clears its selected booking or trip.
  useEffect(() => { if (route?.section !== "trip") app.select(null); }, [route?.section]);

  const nav = useMemo<Nav | null>(() => (data && route ? { route, navigate, addBooking: (tripId) => setAdding({ tripId: tripId ?? null }), setRevisions: () => undefined, data } : null), [route && pathOf(route), navigate, data]);
  if (app.error && !data) return <AppFrame><div className="ri-shell"><Notice tone="danger" title="Travel could not open.">{app.error}</Notice></div></AppFrame>;
  if (!data || !nav) return <AppFrame><div className="ri-shell"><LoadingState label="Opening Travel" /></div></AppFrame>;
  let screen: ReactNode;
  if (nav.route.section === "trip") screen = <TripScreen key={nav.route.tripId} />;
  else if (nav.route.section === "review") screen = <ReviewScreen />;
  else if (nav.route.section === "sources") screen = <SourcesScreenView />;
  else screen = <TripsScreen />;
  return (
    <NavContext.Provider value={nav}>
      <AppFrame>
        {/* Inside an assistant: the way out to Travel's own page, at the place the person is. */}
        {client.embedded && <div className="tr-hostbar"><OpenInBrowser className="ri-button ri-button--quiet ri-button--sm" /></div>}
        {screen}
      </AppFrame>
      <AddBookingDialog
        open={Boolean(adding)}
        tripId={adding?.tripId ?? null}
        onClose={() => setAdding(null)}
        onApplied={(tripId) => {
          setAdding(null);
          if (tripId) navigate({ section: "trip", tripId, tab: "itinerary", day: null, selected: null, status: "all", q: "" });
        }}
      />
    </NavContext.Provider>
  );
}

/** Trips, Review and Sources: the app's top-level sections. */
export function MainTabs({ value }: { value: "trips" | "review" | "sources" }) {
  const { navigate, data } = useNav();
  return (
    <SectionTabs
      label="Travel sections"
      panelId="travel-main"
      value={value}
      onChange={(id) => navigate(id === "review" ? { section: "review", tripId: null } : { section: id as "trips" | "sources" })}
      items={[
        { id: "trips", label: "Trips" },
        { id: "review", label: "Review", badge: data.setup.reviewOpen || undefined },
        ...(data.owner ? [{ id: "sources", label: "Sources" }] : []),
      ]}
    />
  );
}
