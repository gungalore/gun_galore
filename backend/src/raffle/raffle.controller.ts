import { Controller, Get } from '@nestjs/common';
import { RaffleService } from './raffle.service';

/**
 * Public prize-draw surface — drives the /raffle page. Anonymous-readable
 * (it is a marketing surface); returns { enabled:false } while the master
 * flag is off so the page can render a teaser.
 */
@Controller('raffle')
export class RaffleController {
  constructor(private readonly raffle: RaffleService) {}

  @Get()
  state() {
    return this.raffle.publicState();
  }
}
