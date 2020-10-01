import argon2 from 'argon2';
import {
  Arg,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from 'type-graphql';
import { v4 as uuidv4 } from 'uuid';

import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants';
import { User } from '../entities/User';
import { MyContext } from '../types';
import { sendEmail } from '../utils/sendEmail';
import { validateRegister } from '../utils/validateRegister';
import { UsernamePasswordInput } from './UsernamePasswordInput';

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
    @Ctx() { redis, req }: MyContext
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

    const parsedUserId = parseInt(userId);
    const user = await User.findOne(parsedUserId);
    if (!user) {
      return {
        errors: [{ field: 'token', message: 'user no longer exists' }],
      };
    }

    await User.update(
      { id: parsedUserId },
      { password: await argon2.hash(newPassword) }
    );
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
    @Ctx() { redis }: MyContext
  ) {
    const user = await User.findOne({ where: { email } });
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
  me(@Ctx() { req }: MyContext) {
    if (!req.session?.userId) {
      return null;
    }

    return User.findOne(req.session.userId);
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const validationErrors = validateRegister(options);
    if (validationErrors) return { errors: validationErrors };

    const hashedPassword = await argon2.hash(options.password);

    try {
      const user = await User.create({
        username: options.username,
        email: options.email,
        password: hashedPassword,
      }).save();

      // Store user id in cookie so that they're logged in immediately post-creation
      req.session!.userId = user.id;

      return { user };
    } catch (e) {
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
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne(
      usernameOrEmail.includes('@')
        ? { where: { email: usernameOrEmail } }
        : { where: { username: usernameOrEmail } }
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
