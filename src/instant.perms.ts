import type { InstantRules } from '@instantdb/react';

const rules = {
  syncRecords: {
    allow: {
      view: 'auth.id != null && auth.id == data.ownerId',
      create: 'auth.id != null && auth.id == data.ownerId',
      update:
        'auth.id != null && auth.id == data.ownerId && auth.id == newData.ownerId',
      delete: 'auth.id != null && auth.id == data.ownerId',
    },
  },
} satisfies InstantRules;

export default rules;
