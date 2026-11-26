// ⚠️ 2026-11 MARKETPLACE audit: POST /admin/listings/bulk-review used to throw
// a plain Error for a malformed `action`, which Nest maps to 500 Internal
// Server Error. Bad input must be a 400, not an outage-looking failure.
import { BadRequestException } from '@nestjs/common';
import { AdminListingsController } from './admin.controller';

function makeController() {
  const adminService = {
    bulkReviewListings: jest.fn().mockResolvedValue({ processed: 0, results: [] }),
  };
  const controller = new AdminListingsController(
    adminService as never,
    {} as never,
  );
  return { controller, adminService };
}

describe('AdminListingsController.bulkReview', () => {
  it('turns a bad action into a 400, not a 500', () => {
    const { controller, adminService } = makeController();
    expect(() =>
      controller.bulkReview(
        { sub: 'ADMIN1' },
        { listingIds: ['L1'], action: 'DELETE_EVERYTHING' },
      ),
    ).toThrow(BadRequestException);
    expect(adminService.bulkReviewListings).not.toHaveBeenCalled();
  });

  it('still passes a valid action through', async () => {
    const { controller, adminService } = makeController();
    await controller.bulkReview(
      { sub: 'ADMIN1' },
      { listingIds: ['L1', 'L2'], action: 'REJECT', reason: 'Not as described' },
    );
    expect(adminService.bulkReviewListings).toHaveBeenCalledWith(
      ['L1', 'L2'],
      'ADMIN1',
      'REJECT',
      'Not as described',
    );
  });
});
