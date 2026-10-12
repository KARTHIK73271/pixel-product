import { openDatabase } from '../db/connection';
import { migrate } from '../db/migrate';

const db = await openDatabase();
await migrate(db, (m) => console.log(`[db] ${m}`));
console.log('[db] migrations up to date');
await db.close();
