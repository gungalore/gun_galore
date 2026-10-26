// Send the real dealer stock-confirmation template to an operator address so
// the copy/design can be reviewed without creating a sale.
//
//   npm run dealer-form:test -- gerhard.fourie@alloutdoor.co.za
//
// This only sends the email; it does not create a dealer-portal request or a
// transaction. The link in the test copy points at /dealer-portal/test-preview.

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { NotificationsService } from '../src/notifications/notifications.service';

async function main() {
  const to = (process.argv[2] ?? 'gerhard.fourie@alloutdoor.co.za').trim();
  if (!to) {
    console.error('Usage: npm run dealer-form:test -- <email>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const notifications = app.get(NotificationsService);
    await notifications.sendDealerFormTest(to);
    console.log(`Dealer-form test email sent to ${to}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
