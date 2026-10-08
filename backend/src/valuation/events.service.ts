import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { CaptureEvent, ResearchEvent } from './valuation.types';

/**
 * In-process pub/sub that backs the two SSE endpoints. One Subject per
 * valuation per channel; a subscriber that arrives after an event fired does
 * not replay it (the client also polls GET /valuations/:id as a fallback, so
 * a missed intermediate event is never fatal).
 */
@Injectable()
export class ValuationEvents {
  private readonly capture = new Map<string, Subject<CaptureEvent>>();
  private readonly research = new Map<string, Subject<ResearchEvent>>();

  captureStream(valuationId: string): Observable<CaptureEvent> {
    return this.captureSubject(valuationId).asObservable();
  }

  researchStream(valuationId: string): Observable<ResearchEvent> {
    return this.researchSubject(valuationId).asObservable();
  }

  emitCapture(valuationId: string, event: CaptureEvent): void {
    this.captureSubject(valuationId).next(event);
  }

  emitResearch(valuationId: string, event: ResearchEvent): void {
    this.researchSubject(valuationId).next(event);
  }

  private captureSubject(id: string): Subject<CaptureEvent> {
    let subject = this.capture.get(id);
    if (!subject) {
      subject = new Subject<CaptureEvent>();
      this.capture.set(id, subject);
    }
    return subject;
  }

  private researchSubject(id: string): Subject<ResearchEvent> {
    let subject = this.research.get(id);
    if (!subject) {
      subject = new Subject<ResearchEvent>();
      this.research.set(id, subject);
    }
    return subject;
  }
}
