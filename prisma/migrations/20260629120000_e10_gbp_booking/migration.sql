-- E10 · GBP booking-link presence (derived from localBusinessLinks at persist).
-- Additive, nullable — safe to deploy with `prisma migrate deploy`.
ALTER TABLE "Business" ADD COLUMN "gbpHasBooking" BOOLEAN;
