-- Cap the guesses against a phone OTP.
--
-- The code is four digits with a ten-minute life, and the only thing standing
-- between an attacker and taking over somebody's phone number was the global
-- 60-requests-a-minute bucket — which is keyed on IP, so rotating IPs walks
-- straight through it. Ten thousand possibilities against an unlimited number
-- of tries is not a verification step.
--
-- Five wrong answers now burns the code and they must request a new one. The
-- counter resets when a fresh code is issued and when one is accepted.
--
-- The send route is throttled separately, in the controller: each call spends
-- a real SMSPortal message.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phoneOtpAttempts" INTEGER NOT NULL DEFAULT 0;
