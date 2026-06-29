// services/apify · public surface.
//
// Apify-backed adapters. The vendor (Apify) hosts our own published actors —
// currently `mapsly-meta-ad-library` (source in `apify-actors/meta-ad-library/`)
// which scrapes the public Meta Ad Library for commercial ads the official
// Graph API can't return outside the EU.
//
// All adapters run via `./client.ts` (start+poll transport) which enforces the
// "no live API in user path" invariant and bills the run's variable Apify cost
// to the open CronRun.

export {
  runActor,
  ApifyError,
  __setFetchForTesting,
  __setTokenForTesting,
  __setSleepForTesting,
  type RunActorOptions,
  type RunActorResult,
} from "./client";

export {
  metaAdLibrarySearch,
  metaAdLibrarySearchUncached,
  MetaAdRowSchema,
  MetaAdvertiserSchema,
  MetaResolutionSchema,
  MetaAdLibraryQuerySchema,
  type MetaAdRow,
  type MetaAdvertiser,
  type MetaPageResolution,
  type MetaAdLibraryQuery,
  type MetaAdLibraryResult,
} from "./meta-ad-library";
