import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';

// SMS sender (SMSPortal). Marked @Global so any feature module — phone
// verification, notification fanout, etc. — can inject SmsService
// without importing this module explicitly.
@Global()
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
