import { i } from '@instantdb/react';

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    syncRecords: i.entity({
      syncKey: i.string().unique().indexed(),
      ownerId: i.string().indexed(),
      kind: i.string().indexed(),
      localId: i.string(),
      position: i.number(),
      payload: i.json(),
      updatedAt: i.number().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

type _AppSchema = typeof _schema;
export interface AppSchema extends _AppSchema {}

const schema: AppSchema = _schema;
export default schema;
