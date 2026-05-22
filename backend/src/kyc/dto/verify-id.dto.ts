import { IsString, Matches } from 'class-validator';

export class VerifyIdDto {
  // SA ID number — exactly 13 digits. We let VerifyNow do the deeper
  // checksum/Home-Affairs validation; this regex just catches obvious
  // typos so we don't hit their endpoint for "abc" or "1234".
  @IsString()
  @Matches(/^\d{13}$/, { message: 'SA ID number must be exactly 13 digits' })
  idNumber!: string;
}
