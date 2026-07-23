import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MyShipmentsService } from './my-shipments.service';

// The account "Shipping" module — a user's incoming (bought) + outgoing
// (sold) shipments in one place, plus firearm hand-off details. Base path
// distinct from the carrier-integration ShippingController ('shipping').
@Controller('my-shipments')
@UseGuards(ClerkGuard)
export class MyShipmentsController {
  constructor(private readonly service: MyShipmentsService) {}

  @Get('me')
  me(@CurrentUser() clerkId: string) {
    return this.service.myShipments(clerkId);
  }
}
