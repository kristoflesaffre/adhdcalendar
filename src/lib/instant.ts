import { init } from '@instantdb/react';
import schema from '../instant.schema';

// Instant app ids are public client identifiers. The admin token is used only
// by the CLI and must never be bundled into the web or iOS application.
const DEFAULT_INSTANT_APP_ID = '21add73a-f30b-4e02-a4cb-c0e168b8cb1c';

export const INSTANT_APP_ID =
  import.meta.env.VITE_INSTANT_APP_ID?.trim() || DEFAULT_INSTANT_APP_ID;

export const db = init({
  appId: INSTANT_APP_ID,
  schema,
  useDateObjects: false,
});
