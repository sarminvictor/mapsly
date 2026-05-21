/**
 * Public API for the prospect-detail module.
 *
 * The page imports queries / types / components directly; this barrel
 * is provided for tests + future external callers.
 */
export {
  deriveAvatar,
  derivePitchWedges,
  deriveSignalBlocks,
  formatAddress,
  getAgencyProspectDetailData,
} from "./queries";
export type { PitchInputs, SignalBlocksInputs } from "./queries";
export {
  EMPTY_PROSPECT_DETAIL,
  type AgencyProspectDetailData,
  type ProspectAppearsInList,
  type ProspectDataSource,
  type ProspectLighthouseSummary,
  type ProspectPitchWedge,
  type ProspectRecord,
  type ProspectSeverity,
  type ProspectSignalBlock,
  type ProspectSignalBlockKey,
  type ProspectSnapshotSummary,
} from "./types";
