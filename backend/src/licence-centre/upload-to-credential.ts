// backend/src/licence-centre/upload-to-credential.ts
//
// The inverse of CREDENTIAL_TO_UPLOAD, for the one direction that map does
// not serve: the marker classifier answers in MotivationUploadKind, and the
// Document Centre files in CredentialKind.
//
// ⚠️ PARTIAL, AND DELIBERATELY SO. Only the kinds the markers can actually
// decide appear here. An upload kind with no entry means "the markers do not
// classify this", which routes the document to the model — which is correct
// for the ones that vary per person (proof of address, a letter of good
// standing on whatever letterhead the association uses).

import { CredentialKind, MotivationUploadKind } from '@prisma/client';

export const UPLOAD_TO_CREDENTIAL: Partial<
  Record<MotivationUploadKind, CredentialKind>
> = {
  [MotivationUploadKind.CURRENT_LICENCE]: CredentialKind.FIREARM_LICENCE,
  [MotivationUploadKind.COMPETENCY_CERTIFICATE]:
    CredentialKind.COMPETENCY_CERTIFICATE,
  [MotivationUploadKind.PROFICIENCY_CERTIFICATE]: CredentialKind.PROFICIENCY,
  [MotivationUploadKind.IDENTITY_DOCUMENT]: CredentialKind.IDENTITY_DOCUMENT,
};
