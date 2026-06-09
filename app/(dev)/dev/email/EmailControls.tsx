"use client";

/**
 * Cold-email admin · overview interactive controls. Each calls a server action
 * (assertAdmin-gated) inside a transition, then router.refresh() to re-pull the
 * server-rendered stats.
 */
import { type CSSProperties, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addSuppression,
  createDefaultCampaign,
  removeSuppression,
  sendSeedTest,
  setGlobalPause,
  setMailboxStatus,
  syncMailboxes,
} from "./actions";

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
const btnDanger: CSSProperties = {
  ...btn,
  background: "#c3553a",
  color: "#fff",
  border: "none",
};
const input: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #d8d2c8",
  fontSize: 13,
};

export function PauseToggle({ paused }: { paused: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      style={paused ? btnPrimary : btnDanger}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setGlobalPause(!paused);
          router.refresh();
        })
      }
    >
      {pending ? "…" : paused ? "▶ Resume sending" : "⏸ Pause all sending"}
    </button>
  );
}

export function SyncMailboxesButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const router = useRouter();
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button
        style={btn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncMailboxes();
            setMsg(`${r.total} mailbox(es) synced from env`);
            router.refresh();
          })
        }
      >
        {pending ? "…" : "Sync mailboxes from env"}
      </button>
      {msg && <span style={{ fontSize: 12, color: "#666" }}>{msg}</span>}
    </span>
  );
}

export function CreateDefaultButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      style={btnPrimary}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createDefaultCampaign();
          router.push(`/dev/email/campaigns/${r.id}`);
        })
      }
    >
      {pending ? "…" : "+ Create default campaign"}
    </button>
  );
}

export function MailboxControls({
  address,
  status,
}: {
  address: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (nextStatus: string, startRamp: boolean) =>
    start(async () => {
      await setMailboxStatus(address, nextStatus, startRamp);
      router.refresh();
    });
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      {status !== "ACTIVE" ? (
        <button
          style={btnPrimary}
          disabled={pending}
          onClick={() => run("ACTIVE", true)}
        >
          Activate + ramp
        </button>
      ) : (
        <button
          style={btn}
          disabled={pending}
          onClick={() => run("PAUSED", false)}
        >
          Pause
        </button>
      )}
    </span>
  );
}

export function SeedTestForm() {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <input
        style={{ ...input, width: 240 }}
        type="email"
        placeholder="your-inbox@gmail.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        style={btn}
        disabled={pending || !email.includes("@")}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await sendSeedTest(email);
            setMsg(r.message);
          })
        }
      >
        {pending ? "Sending…" : "Send seed test"}
      </button>
      {msg && <span style={{ fontSize: 12, color: "#666" }}>{msg}</span>}
    </div>
  );
}

export function SuppressionForm() {
  const [pending, start] = useTransition();
  const [val, setVal] = useState("");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <textarea
        style={{ ...input, width: 320, height: 56, fontFamily: "inherit" }}
        placeholder="emails to suppress (comma / space / newline separated)"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        style={btn}
        disabled={pending || !val.includes("@")}
        onClick={() =>
          start(async () => {
            const r = await addSuppression(val);
            setMsg(`${r.added} added`);
            setVal("");
            router.refresh();
          })
        }
      >
        {pending ? "…" : "Suppress"}
      </button>
      {msg && <span style={{ fontSize: 12, color: "#666" }}>{msg}</span>}
    </div>
  );
}

export function RemoveSuppressionButton({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      style={{ ...btn, padding: "2px 8px", fontSize: 12 }}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeSuppression(email);
          router.refresh();
        })
      }
    >
      remove
    </button>
  );
}
