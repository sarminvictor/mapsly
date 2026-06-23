// modules/playbooks/license.ts · BusinessLicense recording (§4.15)
//
// recordLicenseStatus(businessId, state, trade) writes a BusinessLicense row
// capturing whether we found a state-board license for a business.
//
// TODO(license-board-api): there is no native state-board lookup API wired yet.
// Until one exists, this is a DETERMINISTIC STUB:
//   - If the business already has a license number ON FILE (a service-text
//     license-number pattern, the same regex the license-display detectors use),
//     we record status VERIFIED with that number + source "stub".
//   - Otherwise we record status NOT_FOUND with source "stub".
// When a real board adapter lands, swap the inner lookup for the API call and
// set source to the board name + a verifiedAt timestamp.
//
// Minimal + typed; the row feeds the license_status signal family.
//
// See:
//   - prisma/schema.prisma                          — model BusinessLicense
//   - modules/playbooks/signals/hvac/license-number-absent.ts — LICENSE_NUMBER_RE

import prisma from "@/lib/prisma";

import { LICENSE_NUMBER_RE } from "./signals/hvac/license-number-absent";

/** BusinessLicense.status literal union (kept local per conventions.md). */
export type LicenseStatus = "VERIFIED" | "NOT_FOUND" | "EXPIRED" | "UNKNOWN";

/** Source marker — "stub" until a real state-board adapter is wired. */
export const LICENSE_SOURCE_STUB = "stub";

/** Result of a recordLicenseStatus call. */
export interface RecordLicenseResult {
  readonly businessId: string;
  readonly state: string;
  readonly trade: string | null;
  readonly status: LicenseStatus;
  readonly licenseNumber: string | null;
  readonly source: string;
}

/**
 * Pull the business's service text and return the first license-number match
 * found there, or null. This is the "license on file" proxy the stub uses.
 */
async function licenseNumberOnFile(businessId: string): Promise<string | null> {
  const services = await prisma.businessService.findMany({
    where: { businessId, isActive: true },
    select: { name: true },
  });
  for (const s of services) {
    const m = s.name.match(LICENSE_NUMBER_RE);
    if (m) return m[0];
  }
  return null;
}

/**
 * Record (upsert-by-insert) a BusinessLicense row for a business.
 *
 * Deterministic stub: VERIFIED when a license number is already on file,
 * NOT_FOUND otherwise. `source` is always "stub" today (see the TODO above).
 * `verifiedAt` is set only when VERIFIED, since NOT_FOUND was never verified.
 */
export async function recordLicenseStatus(
  businessId: string,
  state: string,
  trade?: string | null,
): Promise<RecordLicenseResult> {
  const licenseNumber = await licenseNumberOnFile(businessId);
  const status: LicenseStatus = licenseNumber ? "VERIFIED" : "NOT_FOUND";

  await prisma.businessLicense.create({
    data: {
      businessId,
      state,
      trade: trade ?? null,
      licenseNumber,
      status,
      verifiedAt: status === "VERIFIED" ? new Date() : null,
      source: LICENSE_SOURCE_STUB,
    },
  });

  return {
    businessId,
    state,
    trade: trade ?? null,
    status,
    licenseNumber,
    source: LICENSE_SOURCE_STUB,
  };
}
