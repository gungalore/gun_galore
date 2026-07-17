import { VerifyNowService, KycException } from './verifynow.service';

// Locks in the said_verification (SA ID Basic) response parsing against the
// REAL VerifyNow envelope recorded from the live API on 2026-07-17. The
// earlier parser read a singular `data.result` (home_affairs_id_photo shape)
// and would have returned empty name/DOB for this endpoint — this guards the
// fix so a future refactor can't silently regress it.

function mockFetchOnce(status: number, bodyObj: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(bodyObj),
  } as never) as never;
}

// Verbatim shape returned by POST /verify {reportType:"said_verification"}.
const LIVE_SUCCESS = {
  success: true,
  requestId: 'efbf7ee6-33f0-4ad3-810d-61246335b80a',
  user_id: '7493',
  remainingCredits: 30,
  mode: 'production',
  reportType: 'said_verification',
  input: { idNumber: '8001015009087' },
  results: {
    said_verification: {
      Status: 'Success',
      realTimeResults: {
        Status: 'ID Number Valid',
        Verification: {
          Firstnames: 'NALEDI LERATO',
          Lastname: 'KHUMALO',
          Dob: '1991-11-06',
          Age: 34,
          Gender: 'Female',
          Citizenship: 'South African',
          DateIssued: '',
        },
        transaction_id: '19031247',
      },
      transaction_id: '19031247',
    },
  },
};

describe('VerifyNowService.verifyIdBasic', () => {
  const svc = new VerifyNowService();
  const OLD = process.env.VERIFYNOW_BASIC_REPORT_TYPE;
  afterEach(() => {
    if (OLD === undefined) delete process.env.VERIFYNOW_BASIC_REPORT_TYPE;
    else process.env.VERIFYNOW_BASIC_REPORT_TYPE = OLD;
    jest.restoreAllMocks();
  });

  it('parses the nested SAID Verification envelope (names + DOB)', async () => {
    mockFetchOnce(200, LIVE_SUCCESS);
    const r = await svc.verifyIdBasic('8001015009087');
    expect(r.success).toBe(true);
    expect(r.firstName).toBe('NALEDI LERATO');
    expect(r.surname).toBe('KHUMALO');
    expect(r.dob).toBe('1991-11-06'); // YYYY-MM-DD — feeds the cross-check
    expect(r.gender).toBe('Female');
    expect(r.transactionId).toBe('19031247');
  });

  it('sends reportType=said_verification + mode + an Idempotency-Key header', async () => {
    mockFetchOnce(200, LIVE_SUCCESS);
    await svc.verifyIdBasic('8001015009087');
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body).reportType).toBe('said_verification');
    expect(opts.headers['Idempotency-Key']).toBeTruthy();
  });

  it('honours VERIFYNOW_BASIC_REPORT_TYPE override for the reportType', async () => {
    process.env.VERIFYNOW_BASIC_REPORT_TYPE = 'said_basic_v2';
    mockFetchOnce(200, {
      success: true,
      results: {
        said_basic_v2: {
          realTimeResults: {
            Status: 'ID Number Valid',
            Verification: { Firstnames: 'A', Lastname: 'B', Dob: '1990-01-01' },
          },
        },
      },
    });
    const r = await svc.verifyIdBasic('8001015009087');
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).reportType).toBe(
      'said_basic_v2',
    );
    expect(r.firstName).toBe('A');
  });

  it('refuses when realTimeResults.Status reports the ID number invalid', async () => {
    mockFetchOnce(200, {
      success: true,
      results: {
        said_verification: {
          realTimeResults: { Status: 'ID Number Invalid', Verification: {} },
        },
      },
    });
    await expect(svc.verifyIdBasic('8001015009087')).rejects.toBeInstanceOf(
      KycException,
    );
  });

  it('accepts the Enterprise-bundle flat shape as a fallback', async () => {
    mockFetchOnce(200, {
      success: true,
      results: {
        said_verification: {
          Status: 'Success',
          IDValid: true,
          Names: 'JOHN',
          Surname: 'DOE',
          DateOfBirth: '1980-01-01',
          Gender: 'M',
        },
      },
    });
    const r = await svc.verifyIdBasic('8001015009087');
    expect(r.firstName).toBe('JOHN');
    expect(r.surname).toBe('DOE');
    expect(r.dob).toBe('1980-01-01');
  });

  it('throws a KycException on an HTTP error', async () => {
    mockFetchOnce(500, { message: 'boom' });
    await expect(svc.verifyIdBasic('8001015009087')).rejects.toBeInstanceOf(
      KycException,
    );
  });

  it('throws a KycException on success:false', async () => {
    mockFetchOnce(200, { success: false, message: 'nope' });
    await expect(svc.verifyIdBasic('8001015009087')).rejects.toBeInstanceOf(
      KycException,
    );
  });
});
