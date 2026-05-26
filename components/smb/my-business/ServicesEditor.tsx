"use client";

/**
 * SMB "My Business" · services editor (client component).
 *
 * Renders the active services list with inline edit + soft-remove
 * affordances, plus a paneled "Add a service" form and a collapsed
 * "previously removed" section that can restore items.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Warm, plain English. Buttons say "Save", "Remove", not
 *     "Update record" / "Soft-delete".
 *   - Tap targets ≥ 44px (every button has min-height 40px + padding).
 *   - Mobile-first; list items stack vertically on narrow viewports.
 *   - One CTA per visible state — primary is "Add a service" when the
 *     panel is closed, "Save service" when it's open and a row's not
 *     in edit mode.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - All buttons are real <button>s, not divs with onClick.
 *   - Visible focus rings come from globals.css :focus-visible.
 *   - Reorder uses two arrow buttons per row with aria-labels
 *     ("Move {service} up" / "down") — keyboard-first, no drag-drop
 *     dependency. (Drag-drop comes in a Phase 2 polish task.)
 *
 * Per `.claude/rules/realtime-and-optimistic.md`:
 *   - useOptimistic + useTransition so removals, restores, and
 *     reorders reflect immediately. Server confirms in the background.
 *   - On failure the optimistic state reverts (React re-runs from the
 *     source).
 *
 * Per `.claude/rules/copy-voice.md`:
 *   - Active voice. "We'll keep this hidden" beats "This service has
 *     been deactivated".
 *   - No exclamation marks.
 */

import { useMemo, useOptimistic, useState, useTransition } from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  BusinessServiceRow,
  ServiceSource,
} from "@/modules/smb-my-business/types";

export interface ServicesEditorLabels {
  add_cta: string;
  add_name_label: string;
  add_name_placeholder: string;
  add_category_label: string;
  add_category_placeholder: string;
  add_description_label: string;
  add_description_placeholder: string;
  add_submit: string;
  add_cancel: string;
  empty_heading: string;
  empty_body: string;
  row_edit: string;
  row_remove: string;
  row_restore: string;
  row_save: string;
  row_cancel: string;
  row_source_manual: string;
  row_source_auto_google: string;
  row_source_auto_dom: string;
  row_inactive_pill: string;
  row_no_category: string;
  row_no_description: string;
  section_active: string;
  section_inactive: string;
  section_inactive_help: string;
  reorder_help: string;
  move_up: string;
  move_down: string;
}

type ServerAction = (formData: FormData) => Promise<void>;

export interface ServicesEditorActions {
  add: ServerAction;
  rename: ServerAction;
  remove: ServerAction;
  restore: ServerAction;
  reorder: ServerAction;
}

interface ServicesEditorProps {
  services: BusinessServiceRow[];
  labels: ServicesEditorLabels;
  actions: ServicesEditorActions;
}

type OptimisticAction =
  | { kind: "remove"; id: string }
  | { kind: "restore"; id: string }
  | { kind: "reorder"; ids: string[] };

export function ServicesEditor({
  services,
  labels,
  actions,
}: ServicesEditorProps) {
  const [isPending, startTransition] = useTransition();

  const [optimisticServices, applyOptimistic] = useOptimistic<
    BusinessServiceRow[],
    OptimisticAction
  >(services, (state, action) => {
    switch (action.kind) {
      case "remove":
        return state.map((s) =>
          s.id === action.id ? { ...s, isActive: false } : s,
        );
      case "restore":
        return state.map((s) =>
          s.id === action.id ? { ...s, isActive: true } : s,
        );
      case "reorder": {
        const byId = new Map(state.map((s) => [s.id, s]));
        const reordered: BusinessServiceRow[] = [];
        action.ids.forEach((id, idx) => {
          const existing = byId.get(id);
          if (existing) {
            reordered.push({ ...existing, sortOrder: idx });
            byId.delete(id);
          }
        });
        // Anything left wasn't in the reorder set — keep at tail.
        for (const tail of byId.values()) reordered.push(tail);
        return reordered;
      }
      default:
        return state;
    }
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);

  const active = useMemo(
    () => optimisticServices.filter((s) => s.isActive),
    [optimisticServices],
  );
  const inactive = useMemo(
    () => optimisticServices.filter((s) => !s.isActive),
    [optimisticServices],
  );

  function handleAdd(formData: FormData) {
    startTransition(async () => {
      await actions.add(formData);
      setShowAddPanel(false);
    });
  }

  function handleRename(formData: FormData) {
    const id = formData.get("serviceId");
    startTransition(async () => {
      await actions.rename(formData);
      if (typeof id === "string") setEditingId(null);
    });
  }

  function handleRemove(id: string) {
    const formData = new FormData();
    formData.set("serviceId", id);
    startTransition(async () => {
      applyOptimistic({ kind: "remove", id });
      await actions.remove(formData);
    });
  }

  function handleRestore(id: string) {
    const formData = new FormData();
    formData.set("serviceId", id);
    startTransition(async () => {
      applyOptimistic({ kind: "restore", id });
      await actions.restore(formData);
    });
  }

  function handleMove(id: string, delta: -1 | 1) {
    const ids = active.map((s) => s.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const swap = idx + delta;
    if (swap < 0 || swap >= ids.length) return;

    const next = [...ids];
    next[idx] = ids[swap]!;
    next[swap] = id;

    const formData = new FormData();
    formData.set("serviceIds", JSON.stringify(next));

    startTransition(async () => {
      applyOptimistic({ kind: "reorder", ids: next });
      await actions.reorder(formData);
    });
  }

  return (
    <div style={{ marginTop: 14 }}>
      {/* Add panel */}
      {showAddPanel ? (
        <AddServiceForm
          labels={labels}
          onSubmit={handleAdd}
          onCancel={() => setShowAddPanel(false)}
          disabled={isPending}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddPanel(true)}
          style={primaryButtonStyle()}
          disabled={isPending}
        >
          {labels.add_cta}
        </button>
      )}

      {/* Active list */}
      <div style={{ marginTop: 18 }}>
        {active.length === 0 ? (
          <EmptyState heading={labels.empty_heading} body={labels.empty_body} />
        ) : (
          <>
            <SectionHeader
              title={labels.section_active}
              hint={active.length > 1 ? labels.reorder_help : undefined}
            />
            <ul style={listStyle()}>
              {active.map((s, idx) => (
                <li key={s.id} style={listItemStyle()}>
                  {editingId === s.id ? (
                    <EditServiceForm
                      service={s}
                      labels={labels}
                      onSubmit={handleRename}
                      onCancel={() => setEditingId(null)}
                      disabled={isPending}
                    />
                  ) : (
                    <ServiceRow
                      service={s}
                      labels={labels}
                      canMoveUp={idx > 0}
                      canMoveDown={idx < active.length - 1}
                      onEdit={() => setEditingId(s.id)}
                      onRemove={() => handleRemove(s.id)}
                      onMoveUp={() => handleMove(s.id, -1)}
                      onMoveDown={() => handleMove(s.id, 1)}
                      disabled={isPending}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Inactive list (collapsed by default — only shown when there are any) */}
      {inactive.length > 0 ? (
        <InactiveSection
          inactive={inactive}
          labels={labels}
          onRestore={handleRestore}
          disabled={isPending}
        />
      ) : null}
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div
      style={{
        padding: "24px 18px",
        background: "var(--color-bg)",
        border: "1px dashed var(--color-border)",
        borderRadius: 12,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          color: "var(--color-text)",
          marginBottom: 6,
        }}
      >
        {heading}
      </div>
      <div
        style={{
          fontSize: 14,
          color: "var(--color-text-2)",
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
        }}
      >
        {title}
      </div>
      {hint ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-3)",
            marginTop: 4,
            lineHeight: 1.4,
          }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

interface ServiceRowProps {
  service: BusinessServiceRow;
  labels: ServicesEditorLabels;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled: boolean;
}

function ServiceRow({
  service,
  labels,
  canMoveUp,
  canMoveDown,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  disabled,
}: ServiceRowProps) {
  return (
    <div style={rowGridStyle()}>
      <div style={{ minWidth: 0 }}>
        <div style={rowTitleStyle()}>{service.name}</div>
        <div style={rowMetaStyle()}>
          {service.category ? (
            <span style={pillStyle()}>{service.category}</span>
          ) : (
            <span style={mutedPillStyle()}>{labels.row_no_category}</span>
          )}
          <SourceBadge source={service.source} labels={labels} />
        </div>
        {service.description ? (
          <div style={rowDescriptionStyle()}>{service.description}</div>
        ) : null}
      </div>

      <div style={rowActionsStyle()}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp || disabled}
          style={iconButtonStyle(!canMoveUp)}
          aria-label={`${labels.move_up}: ${service.name}`}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown || disabled}
          style={iconButtonStyle(!canMoveDown)}
          aria-label={`${labels.move_down}: ${service.name}`}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          style={secondaryButtonStyle()}
        >
          {labels.row_edit}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          style={dangerButtonStyle()}
        >
          {labels.row_remove}
        </button>
      </div>
    </div>
  );
}

function SourceBadge({
  source,
  labels,
}: {
  source: ServiceSource;
  labels: ServicesEditorLabels;
}) {
  if (source === "manual") {
    return <span style={pillStyle()}>{labels.row_source_manual}</span>;
  }
  if (source === "auto:google") {
    return <span style={autoPillStyle()}>{labels.row_source_auto_google}</span>;
  }
  return <span style={autoPillStyle()}>{labels.row_source_auto_dom}</span>;
}

interface AddFormProps {
  labels: ServicesEditorLabels;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  disabled: boolean;
}

function AddServiceForm({
  labels,
  onSubmit,
  onCancel,
  disabled,
}: AddFormProps) {
  return (
    <form
      action={onSubmit}
      style={{
        padding: "16px 14px 18px",
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
      }}
    >
      <FormField label={labels.add_name_label}>
        <input
          name="name"
          required
          placeholder={labels.add_name_placeholder}
          style={inputStyle()}
          maxLength={80}
        />
      </FormField>
      <FormField label={labels.add_category_label}>
        <input
          name="category"
          placeholder={labels.add_category_placeholder}
          style={inputStyle()}
          maxLength={60}
        />
      </FormField>
      <FormField label={labels.add_description_label}>
        <textarea
          name="description"
          placeholder={labels.add_description_placeholder}
          style={textareaStyle()}
          maxLength={500}
          rows={2}
        />
      </FormField>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button type="submit" disabled={disabled} style={primaryButtonStyle()}>
          {labels.add_submit}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          style={secondaryButtonStyle()}
        >
          {labels.add_cancel}
        </button>
      </div>
    </form>
  );
}

interface EditFormProps {
  service: BusinessServiceRow;
  labels: ServicesEditorLabels;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  disabled: boolean;
}

function EditServiceForm({
  service,
  labels,
  onSubmit,
  onCancel,
  disabled,
}: EditFormProps) {
  return (
    <form action={onSubmit}>
      <input type="hidden" name="serviceId" value={service.id} />
      <FormField label={labels.add_name_label}>
        <input
          name="name"
          required
          defaultValue={service.name}
          style={inputStyle()}
          maxLength={80}
        />
      </FormField>
      <FormField label={labels.add_category_label}>
        <input
          name="category"
          defaultValue={service.category ?? ""}
          placeholder={labels.add_category_placeholder}
          style={inputStyle()}
          maxLength={60}
        />
      </FormField>
      <FormField label={labels.add_description_label}>
        <textarea
          name="description"
          defaultValue={service.description ?? ""}
          placeholder={labels.add_description_placeholder}
          style={textareaStyle()}
          maxLength={500}
          rows={2}
        />
      </FormField>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button type="submit" disabled={disabled} style={primaryButtonStyle()}>
          {labels.row_save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          style={secondaryButtonStyle()}
        >
          {labels.row_cancel}
        </button>
      </div>
    </form>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={fieldLabelStyle()}>
      {label}
      {children}
    </label>
  );
}

function InactiveSection({
  inactive,
  labels,
  onRestore,
  disabled,
}: {
  inactive: BusinessServiceRow[];
  labels: ServicesEditorLabels;
  onRestore: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{ marginTop: 20 }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-3)",
          padding: "8px 0",
        }}
      >
        {labels.section_inactive} ({inactive.length})
      </summary>
      <p
        style={{
          margin: "4px 0 10px",
          fontSize: 12,
          color: "var(--color-text-3)",
          lineHeight: 1.4,
        }}
      >
        {labels.section_inactive_help}
      </p>
      <ul style={listStyle()}>
        {inactive.map((s) => (
          <li key={s.id} style={{ ...listItemStyle(), opacity: 0.7 }}>
            <div style={rowGridStyle()}>
              <div style={{ minWidth: 0 }}>
                <div style={rowTitleStyle()}>
                  {s.name}
                  <span style={{ marginLeft: 8 }}>
                    <span style={mutedPillStyle()}>
                      {labels.row_inactive_pill}
                    </span>
                  </span>
                </div>
                <div style={rowMetaStyle()}>
                  <SourceBadge source={s.source} labels={labels} />
                </div>
              </div>
              <div style={rowActionsStyle()}>
                <button
                  type="button"
                  onClick={() => onRestore(s.id)}
                  disabled={disabled}
                  style={secondaryButtonStyle()}
                >
                  {labels.row_restore}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

function listStyle(): CSSProperties {
  return {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };
}

function listItemStyle(): CSSProperties {
  return {
    padding: "14px 14px 16px",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
  };
}

function rowGridStyle(): CSSProperties {
  return {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
  };
}

function rowTitleStyle(): CSSProperties {
  return {
    fontFamily: "var(--font-serif)",
    fontSize: 17,
    color: "var(--color-text)",
    lineHeight: 1.2,
    wordBreak: "break-word",
  };
}

function rowMetaStyle(): CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  };
}

function rowDescriptionStyle(): CSSProperties {
  return {
    marginTop: 8,
    fontSize: 13,
    color: "var(--color-text-2)",
    lineHeight: 1.5,
    wordBreak: "break-word",
  };
}

function rowActionsStyle(): CSSProperties {
  return {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center",
  };
}

function pillStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "var(--font-mono)",
    background: "var(--color-bg-3)",
    color: "var(--color-text-2)",
    border: "1px solid var(--color-border)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
}

function mutedPillStyle(): CSSProperties {
  return {
    ...pillStyle(),
    color: "var(--color-text-3)",
    background: "var(--color-bg-2)",
  };
}

function autoPillStyle(): CSSProperties {
  return {
    ...pillStyle(),
    background: "rgba(195, 85, 58, 0.08)",
    color: "var(--color-coral)",
    border: "1px solid rgba(195, 85, 58, 0.25)",
  };
}

function fieldLabelStyle(): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--color-text-3)",
  };
}

function inputStyle(): CSSProperties {
  return {
    height: 44,
    padding: "0 12px",
    fontSize: 15,
    fontFamily: "var(--font-sans)",
    textTransform: "none",
    letterSpacing: 0,
    color: "var(--color-text)",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
  };
}

function textareaStyle(): CSSProperties {
  return {
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "var(--font-sans)",
    textTransform: "none",
    letterSpacing: 0,
    color: "var(--color-text)",
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    resize: "vertical",
    lineHeight: 1.5,
  };
}

function primaryButtonStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    minWidth: 44,
    padding: "0 16px",
    background: "var(--color-coral)",
    color: "#fff",
    border: "1px solid var(--color-coral)",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  };
}

function secondaryButtonStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    minWidth: 44,
    padding: "0 14px",
    background: "var(--color-bg-2)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  };
}

function dangerButtonStyle(): CSSProperties {
  return {
    ...secondaryButtonStyle(),
    color: "var(--color-coral)",
    borderColor: "rgba(195, 85, 58, 0.35)",
  };
}

function iconButtonStyle(isDisabled: boolean): CSSProperties {
  return {
    minHeight: 40,
    minWidth: 40,
    padding: 0,
    background: "var(--color-bg-2)",
    color: "var(--color-text-2)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: isDisabled ? "default" : "pointer",
    opacity: isDisabled ? 0.4 : 1,
  };
}
