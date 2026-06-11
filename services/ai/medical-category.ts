/**
 * Human-medical category detection · shared by the PHI reply-draft
 * guardrail (services/ai/reply-draft.ts) and the "HIPAA-aware" badge on
 * the SMB /reviews AI-draft panel.
 *
 * WHY: US regulators have fined dental/medical practices ($10k–$50k)
 * for Google-review replies that confirmed the reviewer was a patient
 * or referenced their treatment. Any business whose category matches
 * here gets the PHI guardrail block appended to its reply-draft system
 * prompt — see `PHI_REPLY_GUARDRAIL` in `reply-draft.ts`.
 *
 * Pattern lineage: extends the medical branch of `nounFor` in
 * `modules/smb-landing/copy.ts` (the "patients" vocabulary regex). Kept
 * separate (not imported) so the marketing copy module and the AI
 * service don't couple; if you add a category here, consider whether
 * `nounFor` needs it too.
 *
 * Bias: deliberately OVER-inclusive. A false positive only makes a
 * reply more discreet (generic thanks, no specifics). A false negative
 * risks a regulatory fine. So "therapist" matches massage therapists
 * too — discretion costs nothing there.
 *
 * VETERINARY DECISION: vet clinics are explicitly EXCLUDED. HIPAA does
 * not cover animal patients, and vet owners benefit from the natural
 * "reference a specific detail" reply style. (Discretion is still good
 * practice for vets, but the regulatory risk that motivated this
 * guardrail doesn't exist — and the warmer replies win reviews.)
 * The vet check runs FIRST because "veterinary clinic" would otherwise
 * match the medical pattern via "clinic".
 */

const VETERINARY_PATTERN =
  /\b(vet|veterinar\w*|animal (hospital|clinic|care)|pet (clinic|hospital|care|groom\w*|wellness|spa))\b/i;

// NOTE: matching runs on a NORMALIZED string — lowercased, with
// hyphens/underscores/slashes collapsed to single spaces — so "Med-Spa",
// "IV-therapy", and "weight_loss clinic" all hit the space-separated
// alternatives below. Don't add hyphen variants here; fix normalization
// instead.
const HUMAN_MEDICAL_PATTERN =
  /\b(med spa|medspa|medical|dermat\w*|dental|dentist\w*|clinic|injectab\w*|botox|filler|aesthetic\w*|plastic\w*|surger\w*|surgeon\w*|orthodont\w*|orthoped\w*|physio\w*|physical therap\w*|chiro\w*|vein|laser (clinic|center|centre|hair|spa)|iv |wellness|fertility|optometr\w*|ophthalmolog\w*|audiolog\w*|podiatr\w*|psychiatr\w*|psycholog\w*|mental health|therapist\w*|counsel\w*|urgent care|pediatr\w*|cardiolog\w*|oncolog\w*|gynecolog\w*|obstetric\w*|midwif\w*|dialysis|acupunctur\w*|weight loss (clinic|center|centre|program\w*)|hormone|doctor\w*|physician\w*|hospital|health (center|centre|care)|healthcare)\b/i;

/**
 * True when `category` describes a HUMAN-medical practice — the ones
 * where review replies can leak PHI and trigger HIPAA enforcement.
 *
 * Veterinary categories return false (see module doc).
 *
 * Normalization: case-insensitive, and `-`/`_`/`/` separators are
 * treated as spaces ("Med-Spa" === "med spa"). Category strings arrive
 * from DataForSEO, Google, and manual entry — separator style is not
 * consistent across sources.
 */
export function isHumanMedicalCategory(
  category: string | null | undefined,
): boolean {
  const c = (category ?? "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ");
  if (!c.trim()) return false;
  if (VETERINARY_PATTERN.test(c)) return false;
  return HUMAN_MEDICAL_PATTERN.test(c);
}
