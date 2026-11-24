-- CreateTable
CREATE TABLE IF NOT EXISTS "OtpVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtpVerification_phone_verified_idx" ON "OtpVerification"("phone", "verified");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtpVerification_expiresAt_idx" ON "OtpVerification"("expiresAt");
