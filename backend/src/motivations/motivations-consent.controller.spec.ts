import { BadRequestException } from '@nestjs/common';
import { MotivationsConsentController } from './motivations-consent.controller';
import type { MotivationSellerConsentService } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// THE CONTROLLER'S JOB IS TO FORWARD THE BODY, AND IT DROPPED A FIELD.
//
// ⚠️ THE SELLER INVITE WAS BROKEN IN THREE PLACES AT ONCE, which is what made
// it so hard to see: the panel had no email input, the API client's body type
// had no `email`, and THIS controller's body type had neither. `invite()`
// refuses without a valid address, so the refusal — "Enter a valid email
// address for them." — was byte-identical whether nought, one or two of those
// three had been fixed. Two rounds of fixing changed nothing on screen.
//
// So this asserts the forwarding directly: what the browser sends is what the
// service is called with. A field added to the body type and not passed
// through is the same bug again.
// ────────────────────────────────────────────────────────────────────

const req = { headers: { origin: 'https://alloutdoor.co.za' } } as never;

function make() {
  const invite = jest.fn().mockResolvedValue({ id: 'c1', status: 'INVITED' });
  const service = { invite } as unknown as MotivationSellerConsentService;
  return { invite, controller: new MotivationsConsentController(service) };
}

describe('POST :id/seller-consent', () => {
  it('⚠️ FORWARDS THE SELLER EMAIL, which is what the service refuses without', async () => {
    const { invite, controller } = make();
    await controller.invite('clerk_1', 'mo-1', req, {
      name: 'Pieter Botha',
      phone: '0821234567',
      email: 'pieter@example.co.za',
      applicantName: 'Johan Pretorius',
      firearm: { make: 'CZ' } as never,
    });
    expect(invite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'pieter@example.co.za' }),
    );
  });

  it('forwards the name, the number and the firearm with it', async () => {
    const { invite, controller } = make();
    await controller.invite('clerk_1', 'mo-1', req, {
      name: 'Pieter Botha',
      phone: '0821234567',
      email: 'pieter@example.co.za',
      applicantName: 'Johan Pretorius',
      firearm: { make: 'CZ', label: 'the CZ 9mm' } as never,
    });
    expect(invite).toHaveBeenCalledWith(
      expect.objectContaining({
        motivationId: 'mo-1',
        applicantClerkId: 'clerk_1',
        applicantName: 'Johan Pretorius',
        name: 'Pieter Botha',
        phone: '0821234567',
        firearm: { make: 'CZ', label: 'the CZ 9mm' },
      }),
    );
  });

  it('passes an absent email through as empty rather than undefined', async () => {
    // The service's own check turns that into a sentence the member can read.
    const { invite, controller } = make();
    await controller.invite('clerk_1', 'mo-1', req, {
      name: 'Pieter Botha',
      phone: '0821234567',
      firearm: { make: 'CZ' } as never,
    });
    expect(invite).toHaveBeenCalledWith(
      expect.objectContaining({ email: '' }),
    );
  });

  it('refuses before calling the service when the firearm is missing', async () => {
    const { invite, controller } = make();
    await expect(
      controller.invite('clerk_1', 'mo-1', req, {
        name: 'Pieter Botha',
        phone: '0821234567',
        email: 'pieter@example.co.za',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(invite).not.toHaveBeenCalled();
  });
});
