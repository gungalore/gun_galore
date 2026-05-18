import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ListingsModule } from './listings/listings.module';
import { ShippingModule } from './shipping/shipping.module';
import { PaymentsModule } from './payments/payments.module';
import { MessagesModule } from './messages/messages.module';
import { RatingsModule } from './ratings/ratings.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    PrismaModule,
    CloudinaryModule,
    SearchModule,
    UsersModule,
    CategoriesModule,
    ListingsModule,
    ShippingModule,
    PaymentsModule,
    MessagesModule,
    RatingsModule,
    AdminModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
