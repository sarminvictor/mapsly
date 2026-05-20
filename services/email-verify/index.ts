// services/email-verify · public surface.
//
// SMTP-handshake mailbox verification used by:
//   - SMB onboarding completion (refuse junk addresses before commit)
//   - Agency cohort upload (split deliverable / undeliverable on import)
//   - Monthly email-verification cron (revalidate persisted addresses)
//
// The probe speaks RFC 5321 MAIL FROM / RCPT TO and never sends DATA —
// no message is delivered. See ./smtp.ts for the full conversation,
// caching strategy, and validation surface.

export {
  smtpVerifyEmail,
  smtpVerifyEmailUncached,
  isLikelyDeliverable,
  SmtpVerifyInputSchema,
  SMTP_VERIFY_UNIT_COST_USD,
  __setResolverForTesting,
  __setSocketFactoryForTesting,
  type SmtpVerifyInput,
  type SmtpVerifyResult,
  type SmtpVerifyVerdict,
  type ResolverLike,
  type SocketLike,
  type SocketFactory,
} from "./smtp";
