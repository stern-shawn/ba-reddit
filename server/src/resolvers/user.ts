import argon2 from 'argon2';
import {
  Resolver,
  Query,
  Mutation,
  Arg,
  Field,
  Ctx,
  ObjectType,
} from 'type-graphql';
import { v4 as uuidv4 } from 'uuid';

import { MyContext } from '../types';
import { User } from '../entities/User';
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants';
import { UsernamePasswordInput } from './UsernamePasswordInput';
import { validateRegister } from '../utils/validateRegister';
import { sendEmail } from '../utils/sendEmail';

@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver()
export class UserResolver {
  @Mutation(() => UserResponse)
  async changePassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Ctx() { em, redis, req }: MyContext
  ): Promise<UserResponse> {
    if (newPassword.length <= 3) {
      return {
        errors: [
          { field: 'newPassword', message: 'Length must be greater than 3' },
        ],
      };
    }

    const key = `${FORGET_PASSWORD_PREFIX}${token}`;
    const userId = await redis.get(key);
    if (!userId) {
      return {
        errors: [{ field: 'token', message: 'token expired' }],
      };
    }

    const user = await em.findOne(User, { id: parseInt(userId) });
    if (!user) {
      return {
        errors: [{ field: 'token', message: 'user no longer exists' }],
      };
    }

    user.password = await argon2.hash(newPassword);

    await em.persistAndFlush(user);
    // Clean the token from redis so it cannot be reused maliciously
    await redis.del(key);

    // Log the user in after a change password because we're nice
    req.session!.userId = user.id;

    return {
      user,
    };
  }

  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg('email') email: string,
    @Ctx() { em, redis }: MyContext
  ) {
    const user = await em.findOne(User, { email });
    if (!user) {
      // Email not in the db, return true to avoid people knowing who is in the system for privacy etc
      return true;
    }

    const token = uuidv4();

    await redis.set(
      `${FORGET_PASSWORD_PREFIX}${token}`,
      user.id,
      'ex',
      1000 * 60 * 60 * 24 * 3
    ); // 3 days to reset

    await sendEmail(
      email,
      `<a href="http://localhost:3000/change-password/${token}">reset password</a>`
    );

    return true;
  }

  @Query(() => User, { nullable: true })
  async me(@Ctx() { req, em }: MyContext) {
    if (!req.session?.userId) {
      return null;
    }

    const user = await em.findOne(User, { id: req.session.userId });
    return user;
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const validationErrors = validateRegister(options);
    if (validationErrors) return { errors: validationErrors };

    const hashedPassword = await argon2.hash(options.password);

    try {
      const user = em.create(User, {
        username: options.username,
        email: options.email,
        password: hashedPassword,
      });

      await em.persistAndFlush(user);

      // Store user id in cookie so that they're logged in immediately post-creation
      req.session!.userId = user.id;

      return { user };
    } catch (e) {
      em.clear();

      if (e.code === '23505' || e.detail.includes('already exists')) {
        // Duplicate username
        return {
          errors: [{ field: 'username', message: 'username already taken' }],
        };
      }

      return {
        errors: [
          {
            field: 'username',
            message: 'Something went horribly wrong, please try again',
          },
        ],
      };
    }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const user = await em.findOne(
      User,
      usernameOrEmail.includes('@')
        ? { email: usernameOrEmail }
        : { username: usernameOrEmail }
    );
    if (!user) {
      return {
        errors: [
          { field: 'usernameOrEmail', message: "That username doesn't exist" },
        ],
      };
    }

    const isValid = await argon2.verify(user.password, password);
    if (!isValid) {
      return {
        errors: [{ field: 'password', message: 'Incorrect password' }],
      };
    }

    req.session!.userId = user.id;

    return { user };
  }

  @Mutation(() => Boolean)
  async logout(@Ctx() { req, res }: MyContext): Promise<Boolean> {
    return new Promise((resolve) => {
      // Destroy the redis session
      req.session?.destroy((err) => {
        if (err) {
          console.log(err);
          resolve(false);
          return;
        }

        // If session in redis was destroyed successfully, also clear the user's cookie session
        res.clearCookie(COOKIE_NAME);
        resolve(true);
      });
    });
  }
}
