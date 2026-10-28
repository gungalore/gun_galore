import { Module } from '@nestjs/common';
import { DocumentFilingService } from './document-filing.service';
import { DocumentCaptureService } from '../document-capture/document-capture.service';

/**
 * Jev document filing, shared by the vault (LicenceCentreModule) and the
 * motivation writer (MotivationsModule). Import this module wherever the
 * extract services need to file a document by its raw text.
 *
 * LlmService is @Global, so nothing else is imported here.
 */
@Module({
  providers: [DocumentFilingService, DocumentCaptureService],
  exports: [DocumentFilingService, DocumentCaptureService],
})
export class DocumentFilingModule {}
