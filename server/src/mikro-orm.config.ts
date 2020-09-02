import path from 'path';
import { MikroORM } from '@mikro-orm/core';
import { Post } from './entities/Post';
import { isProd } from './constants';
import { User } from './entities/User';

export default {
  migrations: {
    path: path.join(__dirname, './migrations'), // path to the folder with migrations
    pattern: /^[\w-]+\d+\.[tj]s$/, // regex pattern for the migration files (ts or js)
  },
  entities: [Post, User],
  dbName: 'bareddit',
  type: 'postgresql',
  debug: !isProd,
} as Parameters<typeof MikroORM.init>[0];
