import fs from 'node:fs';
import path from 'node:path';

/**
 * Exclusive single-process lock for an embedded PGlite data directory.
 *
 * PGlite is a single-process database: two processes opening the same directory (for example a
 * watcher restarting the server while the previous instance is still flushing on shutdown) can
 * corrupt it. The lock file holds the owner's PID; a lock whose PID is no longer alive is stale
 * (hard-killed process) and is taken over.
 */
function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function acquireDataDirLock(dataDir: string, timeoutMs = 15_000): Promise<() => void> {
  const lockPath = `${dataDir}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          if (fs.readFileSync(lockPath, 'utf8') === String(process.pid)) fs.unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      };
      process.once('exit', release);
      return release;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const owner = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (!owner || !pidAlive(owner)) {
        fs.rmSync(lockPath, { force: true }); // stale lock from a crashed process
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Database directory ${dataDir} is in use by process ${owner}. Stop the other server (or seed/migrate script) and retry.`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
