import { BadRequestException, ValidationError } from '@nestjs/common';

// Human-readable labels per field (fallback: the field name as-is).
const FIELD_LABELS: Record<string, string> = {
  email: 'The email address',
  password: 'The password',
  currentPassword: 'The current password',
  newPassword: 'The new password',
  firstName: 'The first name',
  lastName: 'The last name',
  fullName: 'The full name',
  phone: 'The phone number',
  address: 'The address',
  city: 'The city',
  postalCode: 'The postal code',
  country: 'The country',
  avatarUrl: 'The profile picture',
  subject: 'The subject',
  message: 'The message',
  content: 'The message',
  name: 'The name',
  price: 'The price',
  stock: 'The stock',
  quantity: 'The quantity',
  token: 'The link',
  role: 'The role',
  status: 'The status',
  priority: 'The priority',
};

function label(prop: string): string {
  return FIELD_LABELS[prop] ?? `The field "${prop}"`;
}

// Translates a class-validator constraint into a consistent English message.
function messageFor(prop: string, constraint: string): string {
  const l = label(prop);
  if (constraint.startsWith('isEmail')) return `${l} is not valid.`;
  if (constraint.startsWith('isUrl')) return `${l} must be a valid URL.`;
  if (constraint.startsWith('minLength')) {
    const n = /(\d+)/.exec(constraint)?.[1];
    return n
      ? `${l} must contain at least ${n} characters.`
      : `${l} is too short.`;
  }
  if (constraint.startsWith('maxLength')) return `${l} is too long.`;
  if (
    constraint.startsWith('isNotEmpty') ||
    constraint.startsWith('isDefined') ||
    constraint.startsWith('isString')
  )
    return `${l} is required.`;
  if (
    constraint.startsWith('isNumber') ||
    constraint.startsWith('isInt') ||
    constraint.startsWith('min') ||
    constraint.startsWith('max')
  )
    return `${l} must be a valid number.`;
  if (constraint.startsWith('isEnum') || constraint.startsWith('isIn'))
    return `${l} is not an allowed value.`;
  if (constraint.startsWith('isBoolean')) return `${l} is invalid.`;
  if (constraint.startsWith('whitelistValidation'))
    return `The field "${prop}" is not allowed.`;
  return `${l} is invalid.`;
}

// Flattens errors (including nested ones) into readable messages.
function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const prop = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      for (const key of Object.keys(err.constraints)) {
        out.push(messageFor(err.property, key));
      }
    }
    if (err.children?.length) {
      out.push(...flatten(err.children, prop));
    }
  }
  return out;
}

// Exception factory wired into the global ValidationPipe.
export function validationExceptionFactory(errors: ValidationError[]) {
  const messages = flatten(errors);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: messages.length ? messages : ['Invalid request.'],
  });
}
