// services/ai barrel · public surface.
//
// Provider-agnostic wrapper around our LLM calls. Today: OpenAI chat
// completions over raw fetch (no SDK dep). Swapping providers means
// rewriting client.ts + pricing.ts; the sentiment/reply/copy entrypoints
// stay stable for callers.
//
// Every entrypoint enforces cost-counter + cron-context invariants per
// .claude/rules/cost-discipline.md — see ./client.ts.

export {
  callOpenAi,
  callOpenAiResponses,
  __setFetchForTesting,
  __setApiKeyForTesting,
  type CallOpenAiOptions,
  type CallOpenAiResult,
  type CallOpenAiResponsesOptions,
  type CallOpenAiResponsesResult,
} from "./client";

export {
  findEmailViaAi,
  DEFAULT_EMAIL_FINDER_MODEL,
  type FindEmailInput,
  type FindEmailResult,
  type FindEmailOptions,
  type FindEmailConfidence,
} from "./email-finder";

export {
  PRICING,
  computeUsd,
  DEFAULT_PER_CALL_CEILING_USD,
  type ModelPricing,
  type SupportedModel,
  type UsageCounts,
} from "./pricing";

export {
  classifyReview,
  classifyReviewUncached,
  ClassifyReviewSchema,
  ALLOWED_THEMES,
  DEFAULT_SENTIMENT_MODEL,
  type ClassifyReviewInput,
  type ClassifyReviewResult,
  type ReviewTheme,
  type Sentiment,
} from "./sentiment";

export {
  draftReply,
  draftReplyUncached,
  ReplyDraftSchema,
  DEFAULT_REPLY_DRAFT_MODEL,
  REPLY_TONES,
  type DraftReplyInput,
  type ReplyDraftResult,
  type ReplyTone,
} from "./reply-draft";

export {
  generateOnePager,
  OnePagerSchema,
  DEFAULT_COPY_GEN_MODEL,
  type GenerateOnePagerInput,
  type OnePagerResult,
  type PitchWedgeInput,
} from "./copy-gen";

export {
  MODEL_DECISION,
  pickModelFor,
  getChoiceFor,
  ALL_MODEL_TASKS,
  type ModelDecision,
  type ModelChoice,
  type ModelTask,
} from "./model-decision";
