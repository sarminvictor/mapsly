"use client";

/**
 * "Add location" form · admin enters city + country + radius. The
 * server action geocodes via Nominatim and ping-validates against
 * DataForSEO before creating the row.
 *
 * One form per category — the categoryId is bound via hidden input.
 */

import { useActionState } from "react";

import { addLocation, type ActionResult } from "../actions";

interface Props {
  categoryId: string;
  categoryLabel: string;
}

const initial: ActionResult<{ locationId: string }> | null = null;

export function AddLocationForm({ categoryId, categoryLabel }: Props) {
  const [state, formAction, pending] = useActionState(addLocation, initial);
  return (
    <form action={formAction} className="admin-form">
      <input type="hidden" name="categoryId" value={categoryId} />
      <p
        className="admin-muted"
        style={{ margin: 0, fontSize: 12, fontWeight: 500 }}
      >
        Add a tracked location for{" "}
        <span style={{ color: "var(--admin-fg)" }}>{categoryLabel}</span>
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr",
          gap: 10,
        }}
      >
        <div className="admin-field">
          <label htmlFor={`city-${categoryId}`} className="admin-label">
            City
          </label>
          <input
            id={`city-${categoryId}`}
            name="city"
            className="admin-input"
            placeholder="Los Angeles"
            required
            disabled={pending}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`province-${categoryId}`} className="admin-label">
            State / Province
          </label>
          <input
            id={`province-${categoryId}`}
            name="province"
            className="admin-input"
            placeholder="CA"
            disabled={pending}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`country-${categoryId}`} className="admin-label">
            Country
          </label>
          <input
            id={`country-${categoryId}`}
            name="country"
            className="admin-input admin-mono"
            placeholder="US"
            maxLength={2}
            defaultValue="US"
            required
            disabled={pending}
            style={{ textTransform: "uppercase" }}
          />
        </div>
        <div className="admin-field">
          <label htmlFor={`radius-${categoryId}`} className="admin-label">
            Radius (km)
          </label>
          <input
            id={`radius-${categoryId}`}
            type="number"
            name="radiusKm"
            className="admin-input"
            defaultValue={10}
            min={1}
            max={50}
            required
            disabled={pending}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="submit"
          className="admin-btn"
          data-variant="primary"
          disabled={pending}
        >
          {pending ? "Verifying…" : "Add location"}
        </button>
        <span className="admin-muted" style={{ fontSize: 11 }}>
          Geocodes via OpenStreetMap, then validates with one DataForSEO ping
          ($0.001).
        </span>
        {state?.ok && state.message ? (
          <span className="admin-msg-ok" style={{ padding: "6px 10px" }}>
            {state.message}
          </span>
        ) : null}
        {state && !state.ok ? (
          <span className="admin-msg-err" style={{ padding: "6px 10px" }}>
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
