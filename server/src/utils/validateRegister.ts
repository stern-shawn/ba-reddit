import { UsernamePasswordInput } from '../resolvers/UsernamePasswordInput';

export const validateRegister = (options: UsernamePasswordInput) => {
  if (options.username.length <= 2) {
    return [{ field: 'username', message: 'Length must be greater than 2' }];
  }

  if (options.username.includes('@')) {
    return [{ field: 'username', message: 'Cannot include an @' }];
  }

  if (!options.email.includes('@')) {
    return [{ field: 'email', message: 'Email address must be valid' }];
  }

  if (options.password.length <= 3) {
    return [{ field: 'password', message: 'Length must be greater than 3' }];
  }

  return null;
};
