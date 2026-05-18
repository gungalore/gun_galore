import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [PrismaModule, CloudinaryModule, SearchModule],
  controllers: [AppController],
})
export class AppModule {}
