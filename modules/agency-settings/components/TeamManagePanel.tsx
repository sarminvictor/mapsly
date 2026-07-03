"use client";

// TeamManagePanel (WP5-8) · the functional Team card body: roster with role
// pills + remove (OWNER only, never self), pending invites with revoke, and
// the invite form (OWNER/ADMIN, seat-cap gated). Replaces the read-only
// roster in agency-settings.
//
// Per .claude/rules/cache-components.md Pattern 4: plain serialized props
// only; the server actions are imported directly. Per
// .claude/rules/ui-ux-agency.md: dense, imperative labels, numbers over
// adjectives. English-only copy (matches the WP5 workbench components).

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { useConfirm } from "@/components/agency/ConfirmProvider";

import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from "@/modules/agency-portal/team/invite-actions";
import type {
  AgencyInviteRow,
  AgencyMemberRow,
  AgencySeatState,
} from "@/modules/agency-settings/types";

export interface TeamManagePanelProps {
  members: AgencyMemberRow[];
  invites: AgencyInviteRow[];
  seats: AgencySeatState;
  /** OWNER/ADMIN — may invite + revoke invites. */
  canManage: boolean;
  /** OWNER — may remove members (never self). */
  isOwner: boolean;
  /** The viewer's userId (blocks self-removal client-side too). */
  selfUserId: string;
}

export function TeamManagePanel({
  members,
  invites,
  seats,
  canManage,
  isOwner,
  selfUserId,
}: TeamManagePanelProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"STAFF" | "ADMIN">("STAFF");
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  const seatsOpen = seats.cap - seats.used > 0;

  function invite() {
    setMsg(null);
    setIsError(false);
    startTransition(async () => {
      const r = await inviteMemberAction({ email: email.trim(), role });
      if (r.status === "ok") {
        setEmail("");
        setMsg(
          r.emailSent
            ? "Invite sent."
            : `Invite created — email delivery unavailable, share the link: ${r.acceptUrl}`,
        );
        router.refresh();
      } else if (r.status === "already_member") {
        setIsError(true);
        setMsg("Already on the team.");
      } else if (r.status === "seat_limit") {
        setIsError(true);
        setMsg(`Seat limit reached (${r.cap}). Upgrade to add seats.`);
      } else if (r.status === "invalid_input") {
        setIsError(true);
        setMsg(r.message);
      } else if (r.status === "forbidden") {
        setIsError(true);
        setMsg("Owner or admin role required.");
      } else {
        setIsError(true);
        setMsg("Couldn't send the invite. Try again.");
      }
    });
  }

  function revoke(inviteId: string) {
    startTransition(async () => {
      const r = await revokeInviteAction({ inviteId });
      if (r.status === "ok") router.refresh();
      else {
        setIsError(true);
        setMsg("Couldn't revoke. Try again.");
      }
    });
  }

  async function remove(memberId: string, label: string) {
    // Destructive → specific confirm (copy-voice.md: state what's lost).
    const ok = await confirm({
      title: `Remove ${label} from the team?`,
      body: "They lose access immediately; the seat frees up.",
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await removeMemberAction({ memberId });
      if (r.status === "ok") router.refresh();
      else {
        setIsError(true);
        setMsg("Couldn't remove. Try again.");
      }
    });
  }

  return (
    <div>
      <p style={styles.seatLine}>
        {seats.used} of {seats.cap} seat{seats.cap === 1 ? "" : "s"} used
        {!seatsOpen ? " · seat limit reached" : ""}
      </p>

      {/* ── Roster ── */}
      {members.length === 0 ? (
        <p style={styles.empty}>—</p>
      ) : (
        <ul style={styles.list}>
          {members.map((m) => (
            <li key={m.id} style={styles.row}>
              <span aria-hidden style={styles.avatar}>
                {(m.userName ?? m.userEmail ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span style={styles.body}>
                <span style={styles.name}>{m.userName ?? m.userEmail}</span>
                <span style={styles.email}>{m.userEmail}</span>
              </span>
              <RolePill role={m.role} />
              {isOwner && m.userId !== selfUserId ? (
                <button
                  type="button"
                  style={styles.removeBtn}
                  disabled={pending}
                  onClick={() => void remove(m.id, m.userName ?? m.userEmail)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* ── Pending invites ── */}
      {invites.length > 0 ? (
        <>
          <p style={styles.subhead}>Pending invites</p>
          <ul style={styles.list}>
            {invites.map((i) => (
              <li key={i.id} style={styles.row}>
                <span aria-hidden style={styles.avatar}>
                  ✉
                </span>
                <span style={styles.body}>
                  <span style={styles.name}>{i.email}</span>
                  <span style={styles.email}>
                    expires {new Date(i.expiresAt).toLocaleDateString()}
                  </span>
                </span>
                <RolePill role={i.role} />
                {canManage ? (
                  <button
                    type="button"
                    style={styles.removeBtn}
                    disabled={pending}
                    onClick={() => revoke(i.id)}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* ── Invite form ── */}
      {canManage ? (
        <div style={styles.inviteRow}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@agency.com"
            aria-label="Invite email"
            style={styles.input}
            disabled={!seatsOpen}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "STAFF" | "ADMIN")}
            aria-label="Invite role"
            style={styles.select}
            disabled={!seatsOpen}
          >
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button
            type="button"
            style={styles.inviteBtn}
            disabled={pending || !seatsOpen || email.trim().length < 5}
            onClick={invite}
          >
            {pending ? "Sending…" : "Send invite"}
          </button>
        </div>
      ) : (
        <p style={styles.empty}>Ask an owner or admin to invite teammates.</p>
      )}
      {canManage && !seatsOpen ? (
        <p style={styles.hint}>
          All seats used. Remove a member or upgrade the plan to invite more.
        </p>
      ) : null}
      {canManage ? (
        <p style={styles.hint}>
          Staff can triage leads and edit touches; only owners and admins can
          spend credits or change billing.
        </p>
      ) : null}

      {msg ? (
        <p
          role={isError ? "alert" : undefined}
          style={{
            ...styles.hint,
            color: isError ? "#b91c1c" : "var(--color-text)",
            overflowWrap: "anywhere",
          }}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const roleStyle: CSSProperties =
    role === "OWNER"
      ? {
          background: "var(--color-agency-indigo, #5b3df5)",
          color: "#fff",
          borderColor: "transparent",
        }
      : role === "ADMIN"
        ? { background: "#475569", color: "#fff", borderColor: "transparent" }
        : {
            background: "var(--color-bg)",
            color: "var(--color-text-2)",
            borderColor: "var(--color-border)",
          };
  return (
    <span style={{ ...styles.rolePill, ...roleStyle }}>
      {role.charAt(0) + role.slice(1).toLowerCase()}
    </span>
  );
}

const styles: Record<string, CSSProperties> = {
  seatLine: {
    margin: "0 0 10px",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    fontSize: 12.5,
    color: "var(--color-text-2)",
  },
  subhead: {
    margin: "14px 0 6px",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--color-text-2)",
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
  },
  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "var(--color-bg-2)",
    color: "var(--color-text-2)",
    fontSize: 13,
    fontWeight: 600,
    flex: "0 0 auto",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: "1 1 auto",
    minWidth: 0,
  },
  name: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  email: {
    fontSize: 12.5,
    color: "var(--color-text-2)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rolePill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    borderRadius: 999,
    border: "1px solid",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    flex: "0 0 auto",
  },
  removeBtn: {
    padding: "6px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "#b91c1c",
    cursor: "pointer",
    flex: "0 0 auto",
  },
  inviteRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
    alignItems: "center",
  },
  input: {
    flex: "1 1 220px",
    padding: "10px 12px",
    fontSize: 14,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    minHeight: 42,
    boxSizing: "border-box",
  },
  select: {
    padding: "10px 12px",
    fontSize: 14,
    borderRadius: 10,
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    minHeight: 42,
    boxSizing: "border-box",
  },
  inviteBtn: {
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    background: "var(--color-agency-indigo, #5b3df5)",
    color: "#fff",
    cursor: "pointer",
    minHeight: 42,
  },
  empty: { margin: "10px 0 0", fontSize: 14, color: "var(--color-text-2)" },
  hint: { margin: "8px 0 0", fontSize: 12.5, color: "var(--color-text-2)" },
};
