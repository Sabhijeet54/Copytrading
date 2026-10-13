import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../auth/dto/auth.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  /** Send an empty string to clear the mobile number. */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_o, v) => v !== '')
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Enter a valid mobile number' })
  mobile?: string;

  /** Telegram chat id for personal alerts. Empty string clears it. */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_o, v) => v !== '')
  @Matches(/^-?\d{4,20}$/, { message: 'Enter a numeric Telegram chat id' })
  telegramChatId?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}
