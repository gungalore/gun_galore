import { MotivationLicenceType, MotivationUploadKind as K } from '@prisma/client';
import { pickableKinds } from './motivation-documents';
import { buildChecklist } from './motivation-checklist';

it('scratch', () => {
  const all = [K.IDENTITY_DOCUMENT, K.COMPETENCY_CERTIFICATE, K.ADDRESS_CONFIRMATION,
    K.SAFE_PHOTO_CLOSED, K.SAFE_PHOTO_AJAR, K.SAFE_PHOTO_BOLTS, K.INCIDENT_REPORT, K.CHARACTER_REFERENCE];
  console.log('PICKER S13:', pickableKinds(MotivationLicenceType.S13_SELF_DEFENCE).map(p=>`${p.kind}|${p.tier}`).join(', '));
  const c = buildChecklist(MotivationLicenceType.S13_SELF_DEFENCE, all, true);
  console.log('CHECKLIST ours:', c.sections[0].items.map(i=>`${i.key}=${i.done}`).join(', '));
  console.log('oursDone/oursTotal', c.oursDone, '/', c.oursTotal);
});
