import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class AppController {
  // Health is the first thing every uptime monitor + load balancer
  // pings. Skip the rate limiter — otherwise a noisy probe (or k8s
  // liveness check) would exhaust the IP's quota and lock real users
  // out via shared egress.
  @SkipThrottle()
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
