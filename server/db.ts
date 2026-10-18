import pg from 'pg';
import { config } from 'dotenv';

config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 4,
  connectionTimeoutMillis: 15000,
  query_timeout: 30000,
  idleTimeoutMillis: 15000,
});

export type DbClient = pg.PoolClient;
export type Actor = { id: string; role: 'employee' | 'admin' | 'system' };

export async function withUser<T>(actor: Actor, run: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE app_user');
    await client.query(`SELECT set_config('app.role', $1, true)`, [actor.role]);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [actor.role === 'system' ? '' : actor.id]);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already idle */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
