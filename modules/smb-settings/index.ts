/**
 * SMB settings · module barrel.
 *
 * Server-only surface. Client components should never import from
 * this barrel — they'd drag Prisma + NextAuth into the client bundle.
 */

export { getSmbSettingsData } from "./queries";
export { signOutFromSettings, setPreferredLocale } from "./actions";
export { EMPTY_SMB_SETTINGS, type SmbSettingsData } from "./types";
