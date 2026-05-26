/**
 * SMB · service-context chip wrapper for analysis pages.
 *
 * Server component. Reads the current user's session, pulls their
 * active services from `getSmbMyBusinessData`, slices to a visible
 * window, and pre-resolves the "+N more" overflow label using the
 * actual count value. Then it hands a fully-resolved string set to
 * the presentational `ServiceContextChip`.
 *
 * The resolution lives here (not in the chip) because the chip is
 * server-renderable and we must not pass functions or unresolved ICU
 * placeholders across module boundaries — both are fragile under
 * cacheComponents (Pattern 4b in `.claude/rules/cache-components.md`).
 *
 * Per `.claude/rules/cache-components.md`:
 *   - The underlying `getSmbMyBusinessData` already implements Pattern 1
 *     (NEXT_PHASE guard + EMPTY shape). It also shares its cache tag
 *     with `/my-business`, so edits propagate here immediately.
 *
 * Per `.claude/rules/security.md`:
 *   - Returns null for anonymous viewers (the page itself runs the
 *     `unauthorized()` interrupt; this component just renders nothing).
 */

import { auth } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

import { getSmbMyBusinessData } from "@/modules/smb-my-business";

import { ServiceContextChip } from "./ServiceContextChip";

const DEFAULT_MAX_VISIBLE = 3;

export async function ServiceContextChipForCurrentUser({
  maxVisible = DEFAULT_MAX_VISIBLE,
}: {
  maxVisible?: number;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  const data = await getSmbMyBusinessData(session.user.id);

  // Don't render anything when the user has no business yet — the page's
  // own empty state handles that.
  if (data.ownedBusinessId === "") return null;

  const t = await getTranslations("smb.service_context");

  const activeNames = data.services
    .filter((s) => s.isActive)
    .map((s) => s.name);

  const visible = activeNames.slice(0, maxVisible);
  const overflowCount = Math.max(0, activeNames.length - visible.length);
  const overflowLabel =
    overflowCount > 0 ? t("more", { count: overflowCount }) : null;

  return (
    <ServiceContextChip
      visibleServices={visible}
      totalCount={activeNames.length}
      overflowLabel={overflowLabel}
      labels={{
        prefix: t("prefix"),
        empty: t("empty"),
        manage: t("manage"),
      }}
    />
  );
}
