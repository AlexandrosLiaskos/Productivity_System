/** @module server/api/git */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './utils.js';

const execFile = promisify(execFileCb);

/**
 * Run a git command in the repo root.
 * @param {...string} args
 * @returns {Promise<string>} stdout
 */
async function git(...args) {
  const { stdout } = await execFile('git', args, { cwd: ROOT, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

/**
 * Stage all changes and commit with a message.
 * @param {string} message
 * @returns {Promise<string>} commit hash
 */
export async function commit(message) {
  await git('add', '-A');
  await git('commit', '-m', message);
  const hash = await git('rev-parse', '--short', 'HEAD');
  return hash;
}

/**
 * Push to the remote origin.
 * @returns {Promise<string>}
 */
export async function push() {
  return git('push');
}

/**
 * Get the git log as an array of commit objects.
 * @param {number} limit
 * @returns {Promise<Array<{ hash: string, message: string, date: string }>>}
 */
export async function log(limit = 50) {
  const raw = await git('log', `--max-count=${limit}`, '--pretty=format:%h\t%s\t%aI');
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const [hash, message, date] = line.split('\t');
    return { hash, message, date };
  });
}

/**
 * Get the diff for a specific commit.
 * @param {string} hash
 * @returns {Promise<string>} diff output
 */
export async function diff(hash) {
  return git('diff', `${hash}~1`, hash);
}

/**
 * Rewind the repo to a specific commit hash.
 * Creates a new commit that represents the old state (non-destructive).
 * @param {string} hash
 * @returns {Promise<string>} new commit hash
 */
export async function rewind(hash) {
  await git('checkout', hash, '--', '.');
  return commit(`rewind: restore state from ${hash}`);
}
