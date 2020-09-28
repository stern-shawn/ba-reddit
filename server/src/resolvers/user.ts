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

import { MyContext } from '../types';
import { User } from '../entities/User';
import { COOKIE_NAME } from '../constants';
import { UsernamePasswordInput } from './UsernamePasswordInput';
import { validateRegister } from '../utils/validateRegister';

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
  @Mutation(() => Boolean)
  async forgotPassword(@Arg('email') email: string, @Ctx() { em }: MyContext) {
    // TODO
    // const user = await em.findOne(User, { email });
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
