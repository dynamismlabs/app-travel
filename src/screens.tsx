/**
 * Travel's screens: the whole app (src/view, behind the bridge in src/ui),
 * the kit's Settings and consent screens, and one card per `show_*` tool.
 * The same screens render in Travel's own page and inside an assistant.
 */
import React, { useEffect, useState } from "react";
import { Routes, Route } from "react-router";
import { ConnectionSettings, ConsentScreen, useAppClient, ViewCard } from "@app-builder/core/react";
import { TravelBridge } from "./ui/index.js";
import { baseStyles, installStyles, STYLE_ELEMENT_ID } from "./ui/styles.js";
import { TravelApp } from "./view/app.js";
import { TRAVEL_CSS } from "./view/styles.js";
import type { ReviewItem, Trip, TripDetail } from "./view/types.js";

/** Every style Travel's screens use, for the server to render once. */
export function TravelStyles() {
  return <style id={STYLE_ELEMENT_ID} data-complete="" dangerouslySetInnerHTML={{ __html: `${baseStyles}\n${TRAVEL_CSS}\n${CARD_CSS}` }} />;
}

/** The whole app. */
export function Travel() {
  return <TravelBridge opener="open_view"><TravelApp /></TravelBridge>;
}

// ─── Cards for show_* ───────────────────────────────────────────────────────

const CARD_CSS = `
.tr-card { font-family: var(--ri-font); color: var(--ri-text); }
.tr-card__meta { font-size: 12px; color: var(--ri-muted); margin: 0; }
.tr-card__days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tr-card__day h2 { font-size: 12px; font-weight: 650; margin: 0 0 4px; }
.tr-card__day h2 span { font-weight: 450; color: var(--ri-muted); margin-left: 6px; }
.tr-card__items { list-style: none; margin: 0; padding: 0; }
.tr-card__item { display: grid; grid-template-columns: 4.25rem 1fr; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--ri-border); font-size: 13px; }
.tr-card__item:last-child { border-bottom: 0; }
.tr-card__time { color: var(--ri-muted); font-variant-numeric: tabular-nums; }
.tr-card__time small { display: block; font-size: 10px; }
.tr-card__title { overflow-wrap: anywhere; }
.tr-card__title small { display: block; color: var(--ri-muted); font-size: 11px; }
.tr-card__flag { color: var(--ri-warn); font-size: 12px; margin: 0; }
.tr-card__rows { list-style: none; margin: 0; padding: 0; }
.tr-card__row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--ri-border); }
.tr-card__row:last-child { border-bottom: 0; }
.tr-card__row button { flex: 1; min-width: 0; text-align: left; background: none; border: 0; padding: 0; color: inherit; font: inherit; }
.tr-card__row strong { display: block; font-size: 14px; font-weight: 600; }
.tr-card__row span { font-size: 12px; color: var(--ri-muted); }
.tr-card__compare { font-size: 12px; color: var(--ri-muted); margin: 4px 0 0; }
`;

function useCardStyles() {
  useEffect(() => { installStyles(`${TRAVEL_CSS}\n${CARD_CSS}`); }, []);
}

/** show_trip: one trip's itinerary by local day, and what needs attention. */
export function TripCard({ data }: { data: { title: string; detail: TripDetail | null; message: string | null } }) {
  useCardStyles();
  const client = useAppClient();
  const detail = data.detail;
  useEffect(() => {
    if (detail) client.select({ id: detail.trip.id, title: `${detail.trip.title} trip, ${detail.trip.dateLabel}` });
    return () => client.select(null);
  }, [detail?.trip.id]);
  if (!detail) return <ViewCard title={data.title}><p className="view-empty">{data.message}</p></ViewCard>;
  const gaps = detail.coverage.gaps.filter((gap) => !gap.dismissed);
  const days = detail.days.filter((day) => day.items.length);
  const shown = days.slice(0, 10);
  return (
    <ViewCard title={data.title} count={detail.trip.dateLabel} footer={days.length > shown.length ? `${days.length - shown.length} more days in ${client.config.name}.` : undefined}>
      <div className="tr-card">
        <p className="tr-card__meta">{detail.bookings.length} booking{detail.bookings.length === 1 ? "" : "s"} recorded{detail.trip.destinations.length ? ` · ${detail.trip.destinations.join(", ")}` : ""}</p>
        {gaps.slice(0, 3).map((gap) => <p key={gap.key} className="tr-card__flag">{gap.message}</p>)}
        {detail.review.length > 0 && <p className="tr-card__flag">{detail.review.length === 1 ? "One item waits in Review." : `${detail.review.length} items wait in Review.`}</p>}
        {shown.length ? (
          <ol className="tr-card__days">
            {shown.map((day) => (
              <li key={day.date} className="tr-card__day">
                <h2>{day.label}{day.zoneLine ? <span>{day.zoneLine}</span> : null}</h2>
                <ul className="tr-card__items">
                  {day.items.slice(0, 8).map((item) => (
                    <li key={item.id} className="tr-card__item">
                      <span className="tr-card__time">{item.time ?? "All day"}{item.zoneLabel ? <small>{item.zoneLabel}</small> : null}</span>
                      <span className="tr-card__title">{item.title}{item.status !== "confirmed" ? ` (${item.status})` : ""}<small>{item.subtitle}</small></span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : <p className="view-empty">No booking recorded for this trip yet.</p>}
      </div>
    </ViewCard>
  );
}

/** show_trips: a list of trips with their dates and attention. */
export function TripsCard({ data }: { data: { title: string; trips: Trip[]; more: boolean } }) {
  useCardStyles();
  const client = useAppClient();
  useEffect(() => () => client.select(null), [client.select]);
  return (
    <ViewCard title={data.title} count={data.trips.length ? `${data.trips.length}${data.more ? "+" : ""}` : undefined} footer={data.more ? `More in ${client.config.name}.` : undefined}>
      {data.trips.length ? (
        <ul className="tr-card tr-card__rows">
          {data.trips.map((trip) => (
            <li key={trip.id} className="tr-card__row">
              <button type="button" onClick={() => client.select({ id: trip.id, title: `${trip.title} trip, ${trip.dateLabel}` })}>
                <strong>{trip.title}</strong>
                <span>{trip.dateLabel} · {trip.bookingCount} booking{trip.bookingCount === 1 ? "" : "s"}{trip.attention ? ` · ${trip.attention}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="view-empty">No trips match.</p>}
    </ViewCard>
  );
}

/**
 * show_review: what waits in Review. The person decides each item in Travel,
 * where the full comparison and choices are, so the card opens it.
 */
export function ReviewCard({ data }: { data: { title: string; items: ReviewItem[]; owner: boolean; more: boolean } }) {
  useCardStyles();
  const client = useAppClient();
  const [items] = useState(data.items);
  useEffect(() => () => client.select(null), [client.select]);
  return (
    <ViewCard title={data.title} count={items.length ? `${items.length}${data.more ? "+" : ""}` : undefined} footer={items.length ? `Decide each one in ${client.config.name}'s Review.` : undefined}>
      {items.length ? (
        <ul className="tr-card tr-card__rows">
          {items.map((item) => (
            <li key={item.id} className="tr-card__row">
              <button type="button" onClick={() => client.select({ id: item.id, title: item.headline })}>
                <strong>{item.headline}</strong>
                <span>{item.reason}</span>
                {item.comparison.slice(0, 2).map((row) => <p key={row.field} className="tr-card__compare">{row.label}: {row.current} now, {row.proposed} in the newer source</p>)}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="view-empty">Nothing waits in Review.</p>}
    </ViewCard>
  );
}

/** Cards for the app's show_* tools. Anything else in an assistant draws the whole app. */
export const viewCards = { show_trip: TripCard, show_trips: TripsCard, show_review: ReviewCard };

export function AppScreens() {
  return (
    <Routes>
      <Route path="/settings" element={<ConnectionSettings />} />
      <Route path="/oauth/consent" element={<ConsentScreen />} />
      <Route path="*" element={<Travel />} />
    </Routes>
  );
}
