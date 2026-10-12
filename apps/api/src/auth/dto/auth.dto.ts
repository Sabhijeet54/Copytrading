import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** At least 10 chars with a letter and a digit; 128 max (argon2 input bound). */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
export const PASSWORD_MESSAGE = 'Password must be 10–128 characters and include at least one letter and one number';

export class RegisterDto {
  @Transform(lower)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Enter a valid mobile number' })
  mobile?: string;

  /** Self-registration is only for masters and followers; admins are provisioned separately. */
  @IsIn(['MASTER', 'FOLLOWER'])
  role!: 'MASTER' | 'FOLLOWER';
}

export class LoginDto {
  @Transform(lower)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ResendVerificationDto {
  @Transform(lower)
  @IsEmail()
  email!: string;
}
