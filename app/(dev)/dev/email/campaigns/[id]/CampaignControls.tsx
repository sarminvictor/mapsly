"use client";

/**
 * Cold-email admin · per-campaign controls: status, settings, the 3-touch
 * sequence editor (edit copy + delays + live preview), and cohort enrollment.
 */
import { type CSSProperties, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  deleteStep,
  enrollCohortAction,
  previewCohortAction,
  setCampaignStatus,
  updateCampaign,
  upsertStep,
} from "../../actions";

const btn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #d8d2c8",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
};
const btnPrimary: CSSProperties = {
  ...btn,
  background: "#5b3df5",
  color: "#fff",
  border: "none",
};
const input: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #d8d2c8",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const label: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  color: "#999",
  display: "block",
  marginBottom: 4,
};

export interface StepData {
  id: string;
  stepOrder: number;
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays: number;
  delayHours: number;
}

export interface CampaignSettings {
  id: string;
  name: string;
  status: string;
  fromName: string | null;
  country: string;
  sendWindowStartHour: number;
  sendWindowEndHour: number;
  sendTimezone: string;
  weekdaysOnly: boolean;
  dailyEnrollCap: number;
}

const STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"];

export function StatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {STATUSES.map((s) => (
        <button
          key={s}
          style={s === status ? btnPrimary : btn}
          disabled={pending || s === status}
          onClick={() =>
            start(async () => {
              await setCampaignStatus(id, s);
              router.refresh();
            })
          }
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function SettingsForm({ campaign }: { campaign: CampaignSettings }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({
    name: campaign.name,
    fromName: campaign.fromName ?? "",
    country: campaign.country,
    sendWindowStartHour: campaign.sendWindowStartHour,
    sendWindowEndHour: campaign.sendWindowEndHour,
    sendTimezone: campaign.sendTimezone,
    weekdaysOnly: campaign.weekdaysOnly,
    dailyEnrollCap: campaign.dailyEnrollCap,
  });
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        gap: 12,
      }}
    >
      <div>
        <label style={label}>name</label>
        <input
          style={input}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </div>
      <div>
        <label style={label}>from name (persona)</label>
        <input
          style={input}
          value={f.fromName}
          onChange={(e) => setF({ ...f, fromName: e.target.value })}
        />
      </div>
      <div>
        <label style={label}>country (US/CA)</label>
        <input
          style={input}
          value={f.country}
          onChange={(e) =>
            setF({ ...f, country: e.target.value.toUpperCase() })
          }
        />
      </div>
      <div>
        <label style={label}>timezone</label>
        <input
          style={input}
          value={f.sendTimezone}
          onChange={(e) => setF({ ...f, sendTimezone: e.target.value })}
        />
      </div>
      <div>
        <label style={label}>window start hour</label>
        <input
          style={input}
          type="number"
          value={f.sendWindowStartHour}
          onChange={(e) =>
            setF({ ...f, sendWindowStartHour: Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label style={label}>window end hour</label>
        <input
          style={input}
          type="number"
          value={f.sendWindowEndHour}
          onChange={(e) =>
            setF({ ...f, sendWindowEndHour: Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label style={label}>daily enroll cap</label>
        <input
          style={input}
          type="number"
          value={f.dailyEnrollCap}
          onChange={(e) =>
            setF({ ...f, dailyEnrollCap: Number(e.target.value) })
          }
        />
      </div>
      <div>
        <label style={label}>weekdays only</label>
        <input
          type="checkbox"
          checked={f.weekdaysOnly}
          onChange={(e) => setF({ ...f, weekdaysOnly: e.target.checked })}
        />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <button
          style={btnPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await updateCampaign(campaign.id, {
                name: f.name,
                fromName: f.fromName || null,
                country: f.country,
                sendWindowStartHour: f.sendWindowStartHour,
                sendWindowEndHour: f.sendWindowEndHour,
                sendTimezone: f.sendTimezone,
                weekdaysOnly: f.weekdaysOnly,
                dailyEnrollCap: f.dailyEnrollCap,
              });
              setMsg("saved");
            })
          }
        >
          {pending ? "…" : "Save settings"}
        </button>
        {msg && <span style={{ fontSize: 12, color: "#1a7f37" }}>{msg}</span>}
      </div>
    </div>
  );
}

function StepCard({
  campaignId,
  step,
}: {
  campaignId: string;
  step: StepData;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [s, setS] = useState(step);
  const tokens =
    "{{businessName}} {{city}} {{rating}} {{reviewCount}} {{unansweredCount}} {{reportUrl}} {{senderFirstName}}";
  return (
    <div
      style={{
        border: "1px solid #ece7df",
        borderRadius: 10,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>Touch {s.stepOrder + 1}</strong>
        <span style={{ fontSize: 12, color: "#999" }}>
          delay {s.delayDays}d {s.delayHours}h
        </span>
      </div>
      <label style={label}>subject</label>
      <input
        style={{ ...input, marginBottom: 8 }}
        value={s.subjectTemplate}
        onChange={(e) => setS({ ...s, subjectTemplate: e.target.value })}
      />
      <label style={label}>body (plain text)</label>
      <textarea
        style={{ ...input, height: 160, marginBottom: 8 }}
        value={s.bodyTemplate}
        onChange={(e) => setS({ ...s, bodyTemplate: e.target.value })}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, color: "#999" }}>delay</span>
        <input
          style={{ ...input, width: 60 }}
          type="number"
          value={s.delayDays}
          onChange={(e) => setS({ ...s, delayDays: Number(e.target.value) })}
        />
        <span style={{ fontSize: 11, color: "#999" }}>days</span>
        <input
          style={{ ...input, width: 60 }}
          type="number"
          value={s.delayHours}
          onChange={(e) => setS({ ...s, delayHours: Number(e.target.value) })}
        />
        <span style={{ fontSize: 11, color: "#999" }}>hours</span>
        <button
          style={btnPrimary}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await upsertStep({
                id: s.id,
                campaignId,
                stepOrder: s.stepOrder,
                subjectTemplate: s.subjectTemplate,
                bodyTemplate: s.bodyTemplate,
                delayDays: s.delayDays,
                delayHours: s.delayHours,
              });
              router.refresh();
            })
          }
        >
          {pending ? "…" : "Save"}
        </button>
        <button
          style={btn}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await deleteStep(s.id);
              router.refresh();
            })
          }
        >
          Delete
        </button>
      </div>
      <p style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>
        tokens: {tokens}
      </p>
    </div>
  );
}

export function StepEditor({
  campaignId,
  steps,
}: {
  campaignId: string;
  steps: StepData[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const nextOrder = steps.length
    ? Math.max(...steps.map((s) => s.stepOrder)) + 1
    : 0;
  return (
    <div>
      {steps.map((s) => (
        <StepCard key={s.id} campaignId={campaignId} step={s} />
      ))}
      <button
        style={btn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await upsertStep({
              id: null,
              campaignId,
              stepOrder: nextOrder,
              subjectTemplate: "New subject — {{businessName}}",
              bodyTemplate:
                "Hi {{businessName}},\n\n…\n\nBest,\n{{senderFirstName}}",
              delayDays: 3,
              delayHours: 0,
            });
            router.refresh();
          })
        }
      >
        {pending ? "…" : "+ Add touch"}
      </button>
    </div>
  );
}

export function EnrollForm({
  campaignId,
  country,
}: {
  campaignId: string;
  country: string;
}) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({ category: "", city: "", limit: 50 });
  const [msg, setMsg] = useState("");
  const router = useRouter();
  const filter = () => ({
    campaignId,
    country,
    category: f.category || undefined,
    city: f.city || undefined,
    limit: f.limit,
  });
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-end",
        flexWrap: "wrap",
      }}
    >
      <div>
        <label style={label}>category (optional)</label>
        <input
          style={{ ...input, width: 160 }}
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value })}
        />
      </div>
      <div>
        <label style={label}>city (optional)</label>
        <input
          style={{ ...input, width: 140 }}
          value={f.city}
          onChange={(e) => setF({ ...f, city: e.target.value })}
        />
      </div>
      <div>
        <label style={label}>limit</label>
        <input
          style={{ ...input, width: 90 }}
          type="number"
          value={f.limit}
          onChange={(e) => setF({ ...f, limit: Number(e.target.value) })}
        />
      </div>
      <button
        style={btn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const n = await previewCohortAction(filter());
            setMsg(
              `${n} eligible candidate(s) (verified email + active landing page, ${country})`,
            );
          })
        }
      >
        Preview
      </button>
      <button
        style={btnPrimary}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await enrollCohortAction(filter());
            setMsg(
              `enrolled ${r.enrolled}, skipped ${r.skipped} of ${r.candidates}`,
            );
            router.refresh();
          })
        }
      >
        {pending ? "…" : "Enroll cohort"}
      </button>
      {msg && <span style={{ fontSize: 12, color: "#666" }}>{msg}</span>}
    </div>
  );
}
