import { Module } from '@nestjs/common';
import { DocumentFilingService } from './document-filing.service';

/**
 * Jev document filing, shared by the vault (LicenceCentreModule) and the
 * motivation writer (MotivationsModule). Import this module wherever the
 * extract services need to file a document by its raw text.
 *
 * LlmService is @Global, so nothing else is imported here.
 */
@Module({
  providers: [DocumentFilingService],
  exports: [DocumentFilingService],
})
export class DocumentFilingModule {}
