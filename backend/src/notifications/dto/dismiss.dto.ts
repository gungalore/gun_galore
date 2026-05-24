import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class DismissNotificationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  ids!: string[];
}
