import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [CloudinaryModule, SearchModule],
  controllers: [AppController],
})
export class AppModule {}
