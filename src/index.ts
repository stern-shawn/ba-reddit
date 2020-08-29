import { MikroORM } from '@mikro-orm/core';
import { Post } from './entities/Post';
import microConfig from './mikro-orm.config';

const main = async () => {
  const orm = await MikroORM.init(microConfig);
  // Run migrations on start
  await orm.getMigrator().up();

  // Test if it works
  const post = orm.em.create(Post, { title: 'my first post' });
  await orm.em.persistAndFlush(post);

  const posts = await orm.em.find(Post, {});
  console.log('posts: ', posts);
};

main();
