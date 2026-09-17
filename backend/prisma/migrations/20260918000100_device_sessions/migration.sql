CREATE TABLE "device_sessions" (
 "id" UUID NOT NULL, "userId" UUID NOT NULL, "publicKey" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ(6) NOT NULL, "revokedAt" TIMESTAMPTZ(6),
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "device_sessions_userId_idx" ON "device_sessions"("userId");
CREATE TABLE "device_proof_nonces" ("id" VARCHAR(64) NOT NULL PRIMARY KEY, "expiresAt" TIMESTAMPTZ(6) NOT NULL);
CREATE INDEX "device_proof_nonces_expiresAt_idx" ON "device_proof_nonces"("expiresAt");

ALTER TABLE "biometric_credentials" ADD COLUMN "devicePublicKey" TEXT;
