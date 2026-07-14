import { BadRequestException, ValidationError } from '@nestjs/common';

// Libellés lisibles par champ (repli : le nom du champ tel quel).
const FIELD_LABELS: Record<string, string> = {
  email: "L'adresse email",
  password: 'Le mot de passe',
  currentPassword: 'Le mot de passe actuel',
  newPassword: 'Le nouveau mot de passe',
  firstName: 'Le prénom',
  lastName: 'Le nom',
  fullName: 'Le nom complet',
  phone: 'Le numéro de téléphone',
  address: "L'adresse",
  city: 'La ville',
  postalCode: 'Le code postal',
  country: 'Le pays',
  avatarUrl: "L'image de profil",
  subject: 'Le sujet',
  message: 'Le message',
  content: 'Le message',
  name: 'Le nom',
  price: 'Le prix',
  stock: 'Le stock',
  quantity: 'La quantité',
  token: 'Le lien',
  role: 'Le rôle',
  status: 'Le statut',
  priority: 'La priorité',
};

function label(prop: string): string {
  return FIELD_LABELS[prop] ?? `Le champ « ${prop} »`;
}

// Traduit une contrainte class-validator en message français cohérent.
function messageFor(prop: string, constraint: string): string {
  const l = label(prop);
  if (constraint.startsWith('isEmail')) return `${l} n'est pas valide.`;
  if (constraint.startsWith('isUrl')) return `${l} doit être une URL valide.`;
  if (constraint.startsWith('minLength')) {
    const n = /(\d+)/.exec(constraint)?.[1];
    return n
      ? `${l} doit contenir au moins ${n} caractères.`
      : `${l} est trop court.`;
  }
  if (constraint.startsWith('maxLength')) return `${l} est trop long.`;
  if (
    constraint.startsWith('isNotEmpty') ||
    constraint.startsWith('isDefined') ||
    constraint.startsWith('isString')
  )
    return `${l} est requis.`;
  if (
    constraint.startsWith('isNumber') ||
    constraint.startsWith('isInt') ||
    constraint.startsWith('min') ||
    constraint.startsWith('max')
  )
    return `${l} doit être un nombre valide.`;
  if (constraint.startsWith('isEnum') || constraint.startsWith('isIn'))
    return `${l} n'est pas une valeur autorisée.`;
  if (constraint.startsWith('isBoolean')) return `${l} est invalide.`;
  if (constraint.startsWith('whitelistValidation'))
    return `Le champ « ${prop} » n'est pas autorisé.`;
  return `${l} est invalide.`;
}

// Aplati les erreurs (y compris imbriquées) en messages lisibles.
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

// Fabrique d'exception branchée sur le ValidationPipe global.
export function validationExceptionFactory(errors: ValidationError[]) {
  const messages = flatten(errors);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: messages.length ? messages : ['Requête invalide.'],
  });
}
