import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { ListingsModule } from './listings/listings.module';

@Module({
  imports: [
    PrismaModule,
    CloudinaryModule,
    SearchModule,
    UsersModule,
    CategoriesModule,
    ListingsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
