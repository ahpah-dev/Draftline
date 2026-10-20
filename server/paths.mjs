import path from 'node:path';
import fs from 'node:fs/promises';

export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function workspacePath(root, input = '.', { write = false } = {}) {
  if (typeof input !== 'string' || input.includes('\0')) throw new Error('Path must be a string without null bytes.');
  if (path.isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith('\\')) throw new Error('Use a path relative to the workspace.');
  const resolved = path.resolve(root, input);
  if (!inside(root, resolved)) throw new Error('Path is outside the workspace.');
  let ancestor = resolved;
  while (true) {
    let stat;
    try {
      stat = await fs.lstat(ancestor);
    } catch (error) {
      if (error.code !== 'ENOENT' || !write || ancestor === root) throw error;
      ancestor = path.dirname(ancestor);
      continue;
    }
    let actual;
    try { actual = await fs.realpath(ancestor); }
    catch (error) {
      if (stat.isSymbolicLink() && error.code === 'ENOENT') throw new Error('Path contains a dangling symbolic link.');
      throw error;
    }
    if (!inside(root, actual)) throw new Error('Path follows a link outside the workspace.');
    break;
  }
  return resolved;
}

export function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join('/') || '.';
}

const ignored = new Set(['.git', 'node_modules', 'dist', '.next', '.cache', '.venv']);

export async function listFiles(root, input = '.') {
  const target = await workspacePath(root, input);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return {
    path: relativePath(root, target),
    entries: entries.filter(entry => !ignored.has(entry.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0, 500).map(entry => ({
      name: entry.name,
      path: relativePath(root, path.join(target, entry.name)),
      type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file',
    })),
  };
}

export async function readFile(root, input) {
  const target = await workspacePath(root, input);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error('Path is not a regular file.');
  if (stat.size > 512 * 1024) throw new Error('File exceeds the 512 KB reading limit.');
  const data = await fs.readFile(target);
  if (data.includes(0)) throw new Error('Binary files are not supported.');
  return { path: relativePath(root, target), content: data.toString('utf8') };
}

export async function searchFiles(root, query, input = '.') {
  const start = await workspacePath(root, input);
  const matches = [];
  let scanned = 0;
  let truncated = false;
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      if (scanned >= 1200 || matches.length >= 100) { truncated = true; return; }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!entry.isFile()) continue;
      scanned++;
      let file;
      try { file = await readFile(root, relativePath(root, absolute)); } catch { continue; }
      file.content.split('\n').forEach((line, index) => {
        if (matches.length < 100 && line.toLowerCase().includes(query.toLowerCase())) matches.push({ path: file.path, line: index + 1, content: line.slice(0, 400) });
      });
    }
  }
  const stat = await fs.stat(start);
  if (!stat.isDirectory()) throw new Error('Search path must be a directory.');
  await walk(start);
  return { query, matches, scanned, truncated };
}

export async function writeFile(root, input, content) {
  if (Buffer.byteLength(content) > 512 * 1024) throw new Error('Write exceeds the 512 KB limit.');
  let target = await workspacePath(root, input, { write: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Recheck links after creating parents and immediately before writing.
  target = await workspacePath(root, input, { write: true });
  await fs.writeFile(target, content, { encoding: 'utf8' });
  return { path: relativePath(root, target), bytes: Buffer.byteLength(content), written: true };
}
