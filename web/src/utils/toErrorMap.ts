import { FieldError } from '../generated/graphql';

export const toErrorMap = (errors: FieldError[]) =>
  errors.reduce<Record<string, string>>((acc, { field, message }) => {
    acc[field] = message;
    return acc;
  }, {});
