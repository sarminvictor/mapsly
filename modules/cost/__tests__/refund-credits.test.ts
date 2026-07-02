// WP6-13 · tests for the dispute make-good refund primitive (refundCredits).
//
// Invariants:
//   - credits the PURCHASED bucket + writes a REFUND ledger row;
//   - IDEMPOTENT per dedupeKey — a second call with the same key is a no-op
//     (a disputed field can't be refunded twice);
//   - 0 credits → no-op (returns refunded: 0).

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  walletFindUniqueMock,
  walletCreateMock,
  walletUpdateMock,
  ledgerFindFirstMock,
  ledgerCreateMock,
  txMock,
} = vi.hoisted(() => ({
  walletFindUniqueMock: vi.fn(),
  walletCreateMock: vi.fn(),
  walletUpdateMock: vi.fn(),
  ledgerFindFirstMock: vi.fn(),
  ledgerCreateMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    agencyWallet: {
      findUnique: walletFindUniqueMock,
      create: walletCreateMock,
      update: walletUpdateMock,
    },
    creditLedger: {
      findFirst: ledgerFindFirstMock,
      create: ledgerCreateMock,
    },
    $transaction: txMock,
  },
  Prisma: {},
}));

import { refundCredits } from "../server";

const WALLET = {
  id: "w1",
  agencyId: "a1",
  planCredits: 0,
  purchasedCredits: 100,
  rolloverCredits: 0,
  heldCredits: 0,
};

beforeEach(() => {
  walletFindUniqueMock.mockReset().mockResolvedValue(WALLET);
  walletCreateMock.mockReset();
  walletUpdateMock.mockReset();
  ledgerFindFirstMock.mockReset();
  ledgerCreateMock.mockReset();
  txMock.mockReset().mockResolvedValue([]);
});

describe("refundCredits (WP6-13)", () => {
  test("credits purchased bucket + writes a REFUND row on first call", async () => {
    ledgerFindFirstMock.mockResolvedValue(null); // no prior refund for this key
    const { refunded } = await refundCredits(
      "a1",
      1,
      "bad-data dispute (wrong_number)",
      "biz1:wrong_number:+13055551212",
    );
    expect(refunded).toBe(1);
    expect(txMock).toHaveBeenCalledTimes(1);
  });

  test("idempotent — a second call with the same key is a no-op", async () => {
    ledgerFindFirstMock.mockResolvedValue({ id: "prior-refund" });
    const { refunded } = await refundCredits(
      "a1",
      1,
      "bad-data dispute (wrong_number)",
      "biz1:wrong_number:+13055551212",
    );
    expect(refunded).toBe(0);
    expect(txMock).not.toHaveBeenCalled();
  });

  test("0 credits → no-op (no ledger dedupe lookup, no write)", async () => {
    const { refunded } = await refundCredits("a1", 0, "n/a", "k");
    expect(refunded).toBe(0);
    expect(ledgerFindFirstMock).not.toHaveBeenCalled();
    expect(txMock).not.toHaveBeenCalled();
  });
});
