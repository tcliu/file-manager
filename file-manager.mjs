#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import sharp from 'sharp';

const cliOptions = parseCliArgs(process.argv.slice(2));
let rootDir = path.resolve(cliOptions.dir);
const requestedPort = parsePort(cliOptions.port);
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_UPLOAD_DIR = 'upload';
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 'All'];
const SESSION_DURATION_MS = 10 * 60 * 1000;
const PROCESSED_DIR_NAME = '.processed';
const THUMBNAIL_DIR_NAME = '.thumbnails';
const THUMBNAIL_MAX_WIDTH = 480;
const THUMBNAIL_MAX_HEIGHT = 360;
const THUMBNAIL_QUALITY = 82;
const VIDEO_THUMBNAIL_QUALITY = 3;
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const THUMBNAIL_SUPPORTED_EXTENSIONS = getSharpInputExtensions();
const THUMBNAIL_UNSUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS]
  .filter((extension) => !THUMBNAIL_SUPPORTED_EXTENSIONS.has(extension));
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm']);
let rootDirs = [];
let appConfig;
let authConfig;
let uploadDir;
const activeSessions = new Map();
const activeVideoConversions = new Map();
const videoConversionStatuses = new Map();
let shuttingDown = false;

async function main() {
  appConfig = await loadAppConfig();

  if (rootDirs.length > 1) {
    const basenames = rootDirs.map(d => path.basename(d));
    const unique = new Set(basenames);

    if (unique.size !== basenames.length) {
      throw new Error('Duplicate directory names not allowed when using multiple root directories');
    }
  }

  for (const dir of rootDirs) {
    const dirStat = await stat(dir).catch(() => null);

    if (!dirStat?.isDirectory()) {
      throw new Error(`Directory not found: ${dir}`);
    }
  }

  authConfig = appConfig.auth;

  if (rootDirs.length === 1) {
    uploadDir = path.join(rootDir, appConfig.uploadDir);
    await mkdir(uploadDir, { recursive: true });
  }

  logThumbnailSupportWarning();

  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.message }));
    });
  });
  const port = await findAvailablePort(requestedPort);

  registerShutdownHandlers(server);

  server.listen(port, () => {
    logEvent('server', 'startup', {
      url: `http://localhost:${port}`,
      root_dir: rootDirs.length > 1 ? rootDirs : rootDir,
      upload_dir: uploadDir,
      auth_enabled: authConfig.enabled,
    });
  });
}

async function handleRequest(request, response) {
  const localPort = response.socket.localPort ?? requestedPort;
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${localPort}`}`);

  if (await handlePageRequest(request, response, url)) {
    return;
  }

  if (await handleLoginApiRequest(request, response, url)) {
    return;
  }

  if (await handleLogoutApiRequest(request, response, url)) {
    return;
  }

  if (!isAuthorizedRequest(request, url)) {
    sendUnauthorized(request, response, url);
    return;
  }

  if (await handleFilesApiRequest(request, response, url)) {
    return;
  }

  if (await handleExtensionsApiRequest(request, response, url)) {
    return;
  }

  if (await handleUploadTargetApiRequest(request, response, url)) {
    return;
  }

  if (await handleVideoPreparationApiRequest(request, response, url)) {
    return;
  }

  if (await handleArchiveContentsApiRequest(request, response, url)) {
    return;
  }

  if (await handleMediaRequest(request, response, url)) {
    return;
  }

  if (await handleThumbnailRequest(request, response, url)) {
    return;
  }

  if (await handleDownloadRequest(request, response, url)) {
    return;
  }

  if (await handleArchiveEntryDownloadRequest(request, response, url)) {
    return;
  }

  if (await handleUploadApiRequest(request, response, url)) {
    return;
  }

  if (await handleZipSelectionApiRequest(request, response, url)) {
    return;
  }

  if (await handleDeleteSelectionApiRequest(request, response, url)) {
    return;
  }

  sendText(request, response, 404, 'Not found');
}

async function handlePageRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/') {
    return false;
  }

  sendHtml(request, response, 200, renderPage(appConfig));
  return true;
}

async function handleLoginApiRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/login') {
    return false;
  }

  if (!authConfig.enabled) {
    sendJson(request, response, 200, { ok: true, token: '', expiresInMs: 0 });
    logAccess(request, 'login', {
      username: '',
      auth_enabled: false,
      result: 'bypass',
    });
    return true;
  }

  const body = await readRequestBody(request);
  const payload = JSON.parse(body.toString('utf8') || '{}');
  const username = typeof payload.username === 'string' ? payload.username : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  if (username !== authConfig.username || password !== authConfig.password) {
    sendJson(request, response, 401, { error: 'Invalid username or password' });
    logAccess(request, 'login_failed', {
      username,
      auth_enabled: true,
      reason: 'invalid_credentials',
    });
    return true;
  }

  const token = createSessionToken(username);
  sendJson(request, response, 200, { ok: true, token, expiresInMs: SESSION_DURATION_MS });
  logAccess(request, 'login', {
    username,
    auth_enabled: true,
    expires_in_ms: SESSION_DURATION_MS,
  });
  return true;
}

async function handleLogoutApiRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/logout') {
    return false;
  }

  if (!authConfig.enabled) {
    sendJson(request, response, 200, { ok: true });
    logAccess(request, 'logout', {
      username: '',
      auth_enabled: false,
      result: 'bypass',
    });
    return true;
  }

  pruneExpiredSessions();
  const token = extractSessionToken(request, url);
  const session = token ? activeSessions.get(token) : null;

  if (!token || !session) {
    sendJson(request, response, 401, { error: 'Authentication required' });
    logAccess(request, 'logout_failed', {
      auth_enabled: true,
      reason: token ? 'invalid_session' : 'missing_session',
    });
    return true;
  }

  activeSessions.delete(token);
  sendJson(request, response, 200, { ok: true });
  logAccess(request, 'logout', {
    username: session.username,
    auth_enabled: true,
  });
  return true;
}

async function handleFilesApiRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/api/files') {
    return false;
  }

  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const pageSize = parsePageSize(url.searchParams.get('pageSize'));
  const view = url.searchParams.get('view') === 'grid' ? 'grid' : 'list';
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const selectedExtensions = url.searchParams.getAll('ext').map((extension) => extension.toLowerCase());
  const listing = await listDirectoryContents(currentDir, selectedExtensions);
  const total = listing.files.length;
  const pagedFiles = pageSize === 'All'
    ? listing.files
    : listing.files.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / pageSize));

  await enrichImageDimensions(pagedFiles);

  if (view === 'grid') {
    await enrichGridFileTimestamps(pagedFiles);
  }

  sendJson(request, response, 200, {
    directory: currentDir,
    directories: listing.directories,
    files: pagedFiles,
    page,
    pageSize,
    total,
    totalPages,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    selectedExtensions,
  });
  logAccess(request, 'dir_navigation', {
    directory: currentDir || '.',
    page,
    page_size: pageSize,
    selected_extensions: selectedExtensions,
    total_directories: listing.directories.length,
    total_files: total,
  });
  return true;
}

async function handleExtensionsApiRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/api/extensions') {
    return false;
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const extensions = await listExtensions(resolveListedDirectoryPath(currentDir), currentDir);
  sendJson(request, response, 200, { extensions });
  return true;
}

async function handleUploadTargetApiRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/api/upload-target') {
    return false;
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const requestedName = normalizeUploadFileName(url.searchParams.get('name') ?? '');
  const destinationDir = resolveUploadDirectoryPath(currentDir);
  const destinationStat = await stat(destinationDir).catch(() => null);

  if (!destinationStat?.isDirectory()) {
    sendJson(request, response, 200, { exists: false, suggestedName: requestedName });
    return true;
  }

  const targetPath = path.join(destinationDir, requestedName);
  const exists = await fileExists(targetPath);
  sendJson(request, response, 200, {
    exists,
    suggestedName: exists ? await suggestAvailableFileName(destinationDir, requestedName) : requestedName,
  });
  return true;
}

async function handleVideoPreparationApiRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/api/video-preparation') {
    return false;
  }

  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    sendJson(request, response, 400, { error: 'Missing file path' });
    return true;
  }

  const filePath = resolveListedFilePath(relativePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    sendJson(request, response, 404, { error: 'File not found' });
    return true;
  }

  sendJson(request, response, 200, await getVideoPreparationStatus(filePath, fileStat));
  return true;
}

async function handleArchiveContentsApiRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/api/archive-contents') {
    return false;
  }

  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    sendJson(request, response, 400, { error: 'Missing file path' });
    logAccess(request, 'archive_view_failed', {
      path: '',
      reason: 'missing_file_path',
    });
    return true;
  }

  let filePath;

  try {
    filePath = resolveListedFilePath(relativePath);
  } catch (error) {
    sendJson(request, response, 400, { error: error.message || 'Invalid file path' });
    logAccess(request, 'archive_view_failed', {
      path: relativePath,
      reason: 'invalid_file_path',
      error: error.message || 'Invalid file path',
    });
    return true;
  }

  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    sendJson(request, response, 404, { error: 'File not found' });
    logAccess(request, 'archive_view_failed', {
      path: relativePath,
      reason: 'file_not_found',
    });
    return true;
  }

  if (path.extname(filePath).slice(1).toLowerCase() !== 'zip') {
    sendJson(request, response, 415, { error: 'Archive preview is only supported for .zip files' });
    logAccess(request, 'archive_view_failed', {
      path: relativePath,
      size: fileStat.size,
      reason: 'unsupported_extension',
    });
    return true;
  }

  try {
    const archiveContents = await listZipArchiveContents(filePath);
    sendJson(request, response, 200, archiveContents);
    logAccess(request, 'archive_view', {
      path: relativePath,
      size: fileStat.size,
      directories: archiveContents.directories.length,
      files: archiveContents.files.length,
    });
  } catch (error) {
    sendJson(request, response, 500, { error: error.message || 'Failed to read archive contents' });
    logAccess(request, 'archive_view_failed', {
      path: relativePath,
      size: fileStat.size,
      reason: 'read_failed',
      error: error.message || 'Failed to read archive contents',
    });
  }

  return true;
}

async function handleMediaRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/media') {
    return false;
  }

  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    sendText(request, response, 400, 'Missing file path');
    return true;
  }

  const filePath = resolveListedFilePath(relativePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    sendText(request, response, 404, 'File not found');
    return true;
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (request.method === 'GET' && IMAGE_EXTENSIONS.has(extension)) {
    logAccess(request, 'file_view', {
      path: relativePath,
      size: fileStat.size,
    });
  }

  const inlineMedia = await resolveInlineMedia(filePath, fileStat);

  await streamInlineFile(request, response, inlineMedia.path, inlineMedia.stat);
  return true;
}

async function handleThumbnailRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/thumbnail') {
    return false;
  }

  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    sendText(request, response, 400, 'Missing file path');
    return true;
  }

  const filePath = resolveListedFilePath(relativePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    sendText(request, response, 404, 'File not found');
    return true;
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();

  let thumbnail;

  if (IMAGE_EXTENSIONS.has(extension)) {
    if (!THUMBNAIL_SUPPORTED_EXTENSIONS.has(extension)) {
      sendText(request, response, 415, `Thumbnail generation is not supported for .${extension} on this server`);
      return true;
    }

    thumbnail = await ensureImageThumbnail(filePath, fileStat);
  } else if (VIDEO_EXTENSIONS.has(extension)) {
    thumbnail = await ensureVideoThumbnail(filePath, fileStat);
  } else {
    sendText(request, response, 400, 'Thumbnail is only available for image and video files');
    return true;
  }

  const thumbnailStat = await stat(thumbnail.path);

  await streamInlineFile(request, response, thumbnail.path, thumbnailStat);
  return true;
}

async function handleDownloadRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/download') {
    return false;
  }

  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    sendText(request, response, 400, 'Missing file path');
    return true;
  }

  const filePath = resolveListedFilePath(relativePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    sendText(request, response, 404, 'File not found');
    return true;
  }

  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': fileStat.size,
    'content-disposition': `attachment; filename="${path.basename(filePath).replaceAll('"', '')}"`,
  });

  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    logAccess(request, 'download', {
      path: relativePath,
      size: fileStat.size,
    });
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Failed to read file');
  });
  stream.pipe(response);
  return true;
}

async function handleArchiveEntryDownloadRequest(request, response, url) {
  if (!isGetOrHeadRequest(request) || url.pathname !== '/archive-entry-download') {
    return false;
  }

  const relativePath = url.searchParams.get('path');
  const entryPath = url.searchParams.get('entry');

  if (!relativePath || !entryPath) {
    sendText(request, response, 400, 'Missing archive path or entry path');
    return true;
  }

  const archivePath = resolveListedFilePath(relativePath);
  const archiveStat = await stat(archivePath).catch(() => null);

  if (!archiveStat?.isFile()) {
    sendText(request, response, 404, 'Archive not found');
    return true;
  }

  if (path.extname(archivePath).slice(1).toLowerCase() !== 'zip') {
    sendText(request, response, 415, 'Archive entry download is only supported for .zip files');
    return true;
  }

  const normalizedEntryPath = normalizeArchiveEntryPath(entryPath);

  if (!normalizedEntryPath) {
    sendText(request, response, 400, 'Invalid archive entry path');
    return true;
  }

  const archiveContents = await listZipArchiveContents(archivePath);
  const archiveFile = archiveContents.files.find((file) => file.path === normalizedEntryPath);

  if (!archiveFile) {
    sendText(request, response, 404, 'Archive entry not found');
    return true;
  }

  await ensureZipArchiveEntryReadable(archivePath, normalizedEntryPath).catch((error) => {
    sendText(request, response, 500, error.message || 'Failed to read archive entry');
  });

  if (response.writableEnded) {
    return true;
  }

  response.writeHead(200, {
    'content-type': getInlineContentType(archiveFile.name),
    'content-disposition': `attachment; filename="${archiveFile.name.replaceAll('"', '')}"`,
  });

  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  try {
    await streamZipArchiveEntry(archivePath, normalizedEntryPath, response);
    logAccess(request, 'archive_entry_download', {
      path: relativePath,
      entry: normalizedEntryPath,
      archive_size: archiveStat.size,
    });
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }

    if (!response.writableEnded) {
      response.end(error.message || 'Failed to read archive entry');
    }
  }

  return true;
}

async function handleUploadApiRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/upload') {
    return false;
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const destinationDir = resolveUploadDirectoryPath(currentDir);
  const overwriteExisting = url.searchParams.get('overwrite') === '1';
  await mkdir(destinationDir, { recursive: true });
  const destinationStat = await stat(destinationDir).catch(() => null);
  const contentType = request.headers['content-type'] ?? '';
  const boundary = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i)?.[1]
    ?? contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i)?.[2];

  if (!destinationStat?.isDirectory()) {
    sendJson(request, response, 400, { error: 'Upload destination not found' });
    return true;
  }

  if (!contentType.startsWith('multipart/form-data') || !boundary) {
    sendJson(request, response, 400, { error: 'Expected multipart/form-data upload' });
    return true;
  }

  const body = await readRequestBody(request);
  let uploaded;
  const uploadLogEntries = [];

  try {
    uploaded = await saveMultipartFiles(body, boundary, destinationDir, {
      overwriteExisting,
      onFileSaved(file) {
        uploadLogEntries.push(file);
      },
    });
  } catch (error) {
    if (error.code === 'EFILEEXISTS') {
      sendJson(request, response, 409, { error: error.message, suggestedName: error.suggestedName ?? '' });
      return true;
    }

    throw error;
  }

  const uploadDirectory = normalizeRelativeDirectory(path.posix.join(currentDir, appConfig.uploadDir)) || appConfig.uploadDir;

  for (const file of uploadLogEntries) {
    logAccess(request, 'upload', {
      directory: currentDir || '.',
      path: normalizeRelativeDirectory(path.posix.join(uploadDirectory, file.fileName)),
      upload_directory: uploadDirectory,
      size: file.size,
      overwrite_existing: overwriteExisting,
    });
  }

  sendJson(request, response, 200, { uploaded });
  return true;
}

async function handleZipSelectionApiRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/zip-selection') {
    return false;
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await readRequestBody(request);
  const payload = JSON.parse(body.toString('utf8') || '{}');
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];

  if (!directoryStat?.isDirectory()) {
    sendJson(request, response, 400, { error: 'Current directory not found' });
    return true;
  }

  if (requestedItems.length === 0) {
    sendJson(request, response, 400, { error: 'No items selected' });
    return true;
  }

  const selectedItems = [];

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (!entryStat || (!entryStat.isFile() && !entryStat.isDirectory())) {
      sendJson(request, response, 400, { error: `Not a zippable item in this directory: ${relativePath}` });
      return true;
    }

    selectedItems.push(path.relative(currentDirectoryPath, entryPath).split(path.sep).join('/'));
  }

  const archiveName = `${formatTimestamp(new Date())}.zip`;
  const temporaryDir = await mkdtemp(path.join(tmpdir(), 'file-manager-zip-'));
  const archivePath = path.join(temporaryDir, archiveName);

  await createZipArchive(currentDirectoryPath, archivePath, selectedItems);
  const archiveStat = await stat(archivePath);

  response.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': archiveStat.size,
    'content-disposition': `attachment; filename="${archiveName}"`,
  });

  const stream = createReadStream(archivePath);
  stream.on('close', () => {
    rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
  });
  stream.on('error', async () => {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});

    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }

    response.end('Failed to create zip file');
  });
  stream.pipe(response);
  return true;
}

async function handleDeleteSelectionApiRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/delete-selection') {
    return false;
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await readRequestBody(request);
  const payload = JSON.parse(body.toString('utf8') || '{}');
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];

  if (!directoryStat?.isDirectory()) {
    sendJson(request, response, 400, { error: 'Current directory not found' });
    return true;
  }

  if (requestedItems.length === 0) {
    sendJson(request, response, 400, { error: 'No items selected' });
    return true;
  }

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (entryStat?.isFile()) {
      continue;
    }

    if (entryStat?.isDirectory() && isUploadSubtreePath(currentDir, relativePath)) {
      continue;
    }

    if (entryStat?.isDirectory()) {
      sendJson(request, response, 400, { error: `Directory deletion is only allowed under upload: ${relativePath}` });
      return true;
    }

    sendJson(request, response, 400, { error: `Not a deletable item in this directory: ${relativePath}` });
    return true;
  }

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (entryStat?.isDirectory()) {
      await rm(entryPath, { recursive: true, force: true });
      continue;
    }

    await unlink(entryPath);

    if (VIDEO_EXTENSIONS.has(path.extname(entryPath).slice(1).toLowerCase())) {
      await rm(getProcessedVideoPath(entryPath), { force: true }).catch(() => {});
    }
  }

  sendJson(request, response, 200, { deleted: requestedItems });
  return true;
}

function isGetOrHeadRequest(request) {
  return request.method === 'GET' || request.method === 'HEAD';
}

function sendHtml(request, response, statusCode, html) {
  response.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  response.end(html);
}

function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  response.end(JSON.stringify(payload));
}

function sendText(request, response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  response.end(body);
}

function sendUnauthorized(request, response, url) {
  if (url.pathname === '/download') {
    sendText(request, response, 401, 'Authentication required');
    return;
  }

  sendJson(request, response, 401, { error: 'Authentication required' });
}

async function listDirectoryContents(relativeDir, selectedExtensions) {
  if (rootDirs.length > 1 && (!relativeDir || relativeDir === '.')) {
    const directories = [];

    for (const dir of rootDirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
      directories.push({
        name: path.basename(dir),
        path: path.basename(dir),
      });
    }

    return { directories, files: [] };
  }

  const targetDir = resolveListedDirectoryPath(relativeDir);
  const entries = await readdir(targetDir, { withFileTypes: true });
  const directories = [];
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const absolutePath = path.join(targetDir, entry.name);
    const relativePath = path.posix.join(relativeDir, entry.name).replace(/^\//, '');

    if (entry.isDirectory()) {
      directories.push({
        name: entry.name,
        path: relativePath,
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).slice(1).toLowerCase();

    if (selectedExtensions.length > 0 && !selectedExtensions.includes(extension)) {
      continue;
    }

    const fileStat = await stat(absolutePath);

    files.push({
      name: entry.name,
      path: relativePath,
      extension,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }

  return { directories, files };
}

async function listZipArchiveContents(filePath) {
  const output = await readZipDirectoryListing(filePath);
  const directories = new Map();
  const files = [];

  for (const rawLine of output.split(/\r?\n/u)) {
    const entryLine = rawLine.trim();

    if (!entryLine) {
      continue;
    }

    const isDirectory = entryLine.endsWith('/');
    const normalizedPath = normalizeArchiveEntryPath(isDirectory ? entryLine.slice(0, -1) : entryLine);

    if (!normalizedPath) {
      continue;
    }

    const parts = normalizedPath.split('/');

    for (let index = 1; index < parts.length; index += 1) {
      const directoryPath = parts.slice(0, index).join('/');

      if (!directories.has(directoryPath)) {
        directories.set(directoryPath, createArchiveDirectoryEntry(directoryPath));
      }
    }

    if (isDirectory) {
      if (!directories.has(normalizedPath)) {
        directories.set(normalizedPath, createArchiveDirectoryEntry(normalizedPath));
      }
      continue;
    }

    files.push(createArchiveFileEntry(normalizedPath));
  }

  return {
    directories: [...directories.values()].sort(compareArchiveEntries),
    files: files.sort(compareArchiveEntries),
  };
}

function createArchiveDirectoryEntry(relativePath) {
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
  };
}

function createArchiveFileEntry(relativePath) {
  const extension = path.posix.extname(relativePath).slice(1).toLowerCase();
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
    extension,
  };
}

function compareArchiveEntries(left, right) {
  return left.path.localeCompare(right.path);
}

function normalizeArchiveEntryPath(relativePath) {
  const normalizedPath = path.posix.normalize('/' + String(relativePath || '')).replace(/^\//, '');

  if (normalizedPath === '.' || normalizedPath === '') {
    return '';
  }

  if (normalizedPath.startsWith('..')) {
    return '';
  }

  return normalizedPath;
}

async function readZipDirectoryListing(filePath) {
  const commands = [
    ['unzip', ['-Z1', filePath]],
    ['zipinfo', ['-1', filePath]],
  ];
  let lastError = null;

  for (const [command, args] of commands) {
    try {
      return await runCommandCapture(command, args);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError?.message || 'Unable to read zip archive contents');
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run ${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(`Failed to read zip archive with ${command}: ${details}`));
    });
  });
}

function streamZipArchiveEntry(filePath, entryPath, response) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', filePath, entryPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    function finishWithError(error) {
      if (settled) {
        return;
      }

      settled = true;

      if (!child.killed) {
        child.kill('SIGTERM');
      }

      reject(error);
    }

    function finishSuccessfully() {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    }

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finishWithError(new Error(`Failed to run unzip: ${error.message}`));
    });

    child.stdout.on('error', () => {
      finishWithError(new Error('Failed to read archive entry'));
    });

    response.on('close', () => {
      finishWithError(new Error('Download cancelled'));
    });

    child.stdout.pipe(response, { end: false });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      if (code === 0) {
        if (!response.writableEnded) {
          response.end();
        }
        finishSuccessfully();
        return;
      }

      finishWithError(new Error(stderr.trim() || `Failed to read archive entry (exit code ${code})`));
    });
  });
}

function ensureZipArchiveEntryReadable(filePath, entryPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-tqq', filePath, entryPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run unzip: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Failed to validate archive entry (exit code ${code})`));
    });
  });
}

async function enrichImageDimensions(files) {
  await Promise.all(files.map(async (file) => {
    if (!IMAGE_EXTENSIONS.has(file.extension)) {
      return;
    }

    const metadata = await readImageMetadata(resolveListedFilePath(file.path));

    if (metadata.width && metadata.height) {
      file.width = metadata.width;
      file.height = metadata.height;
    }
  }));
}

async function enrichGridFileTimestamps(files) {
  await Promise.all(files.map(async (file) => {
    if (!IMAGE_EXTENSIONS.has(file.extension)) {
      return;
    }

    const metadata = await readImageMetadata(resolveListedFilePath(file.path));

    if (metadata.timestamp) {
      file.modifiedAt = metadata.timestamp;
    }
  }));
}

async function readImageMetadata(filePath) {
  try {
    const metadata = await sharp(filePath, { pages: 1 }).metadata();
    const candidate = extractImageTimestamp(metadata);
    const parsed = candidate ? parseExifTimestamp(candidate) : null;
    return {
      timestamp: parsed ? parsed.toISOString() : null,
      width: Number.isFinite(metadata.width) ? metadata.width : null,
      height: Number.isFinite(metadata.height) ? metadata.height : null,
    };
  } catch {
    return {
      timestamp: null,
      width: null,
      height: null,
    };
  }
}

function extractImageTimestamp(metadata) {
  if (typeof metadata.exif === 'undefined' || metadata.exif === null) {
    return null;
  }

  return metadata.dateTimeOriginal
    ?? metadata.createDate
    ?? metadata.modifyDate
    ?? metadata.dateTime
    ?? null;
}

function parseExifTimestamp(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const exifMatch = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);

  if (exifMatch) {
    const [, year, month, day, hours, minutes, seconds] = exifMatch;
    const parsed = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function listExtensions(dir, relativeDir) {
  if (rootDirs.length > 1 && (!relativeDir || relativeDir === '.')) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const extensions = new Set();

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).slice(1).toLowerCase();

    if (extension) {
      extensions.add(extension);
    }
  }

  return [...extensions].sort();
}

function createSessionToken(username = '') {
  pruneExpiredSessions();
  const token = randomUUID();
  activeSessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  });
  return token;
}

function isAuthorizedRequest(request, url) {
  if (!authConfig.enabled) {
    return true;
  }

  if (url.pathname === '/' || url.pathname === '/api/login' || url.pathname === '/api/logout') {
    return true;
  }

  pruneExpiredSessions();
  const token = extractSessionToken(request, url);

  if (!token) {
    return false;
  }

  const session = activeSessions.get(token);

  if (!session || Date.now() >= session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }

  return true;
}

function extractSessionToken(request, url) {
  const headerToken = request.headers['x-session-token'];

  if (typeof headerToken === 'string' && headerToken) {
    return headerToken;
  }

  const queryToken = url.searchParams.get('token');
  return queryToken || '';
}

function pruneExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of activeSessions.entries()) {
    if (now >= session.expiresAt) {
      activeSessions.delete(token);
    }
  }
}

async function loadAppConfig() {
  const entries = await loadEnvEntries(rootDir);

  if (entries['root-dir']) {
    const parts = entries['root-dir'].split(',').map(d => d.trim()).filter(Boolean);
    rootDirs = parts.map(d => path.resolve(rootDir, d));

    if (rootDirs.length === 1) {
      rootDir = rootDirs[0];
    }
  } else {
    rootDirs = [rootDir];
  }

  const username = entries['username'] ?? entries['user-name'] ?? '';
  const password = entries.password ?? '';

  if (password && !username) {
    throw new Error('username must be set when password is configured in .env or .env.local');
  }

  return {
    auth: {
      enabled: password !== '',
      username,
      password,
    },
    uploadDir: normalizeConfiguredDir(entries['upload-dir'], DEFAULT_UPLOAD_DIR),
  };
}

async function loadEnvEntries(baseDir) {
  const mergedEntries = {};

  for (const fileName of ['.env', '.env.local']) {
    const envPath = path.join(baseDir, fileName);
    const content = await readFile(envPath, 'utf8').catch(() => null);

    if (content === null) {
      continue;
    }

    Object.assign(mergedEntries, parseEnvFile(content));
  }

  return mergedEntries;
}

function parseEnvFile(content) {
  const entries = {};

  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

function normalizeConfiguredDir(value, fallback) {
  const rawValue = typeof value === 'string' && value.trim() ? value.trim() : fallback;

  if (rootDirs.length > 1) {
    for (const dir of rootDirs) {
      const resolvedPath = path.resolve(dir, rawValue);
      const relativePath = path.relative(dir, resolvedPath);

      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return rawValue;
      }
    }

    throw new Error(`Configured directory must stay within a root directory: ${rawValue}`);
  }

  const resolvedPath = path.resolve(rootDir, rawValue);
  const relativePath = path.relative(rootDir, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Configured directory must stay within root directory: ${rawValue}`);
  }

  return relativePath.split(path.sep).join('/');
}

async function streamInlineFile(request, response, filePath, fileStat) {
  const contentType = getInlineContentType(filePath);
  const rangeHeader = request.headers.range;

  if (!rangeHeader) {
    response.writeHead(200, {
      'accept-ranges': 'bytes',
      'content-length': fileStat.size,
      'content-type': contentType,
      'content-disposition': `inline; filename="${path.basename(filePath).replaceAll('"', '')}"`,
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      response.end('Failed to read file');
    });
    stream.pipe(response);
    return;
  }

  const rangeMatch = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader);

  if (!rangeMatch) {
    response.writeHead(416, {
      'content-range': `bytes */${fileStat.size}`,
      'content-type': 'text/plain; charset=utf-8',
    });
    response.end('Invalid range');
    return;
  }

  const start = rangeMatch[1] ? Number(rangeMatch[1]) : null;
  const end = rangeMatch[2] ? Number(rangeMatch[2]) : null;
  let rangeStart;
  let rangeEnd;

  if (start === null && end === null) {
    response.writeHead(416, {
      'content-range': `bytes */${fileStat.size}`,
      'content-type': 'text/plain; charset=utf-8',
    });
    response.end('Invalid range');
    return;
  }

  if (start === null) {
    const suffixLength = end;
    rangeStart = Math.max(0, fileStat.size - suffixLength);
    rangeEnd = fileStat.size - 1;
  } else {
    rangeStart = start;
    rangeEnd = end === null ? fileStat.size - 1 : end;
  }

  if (
    !Number.isInteger(rangeStart)
    || !Number.isInteger(rangeEnd)
    || rangeStart < 0
    || rangeEnd < rangeStart
    || rangeStart >= fileStat.size
  ) {
    response.writeHead(416, {
      'content-range': `bytes */${fileStat.size}`,
      'content-type': 'text/plain; charset=utf-8',
    });
    response.end('Requested range not satisfiable');
    return;
  }

  rangeEnd = Math.min(rangeEnd, fileStat.size - 1);
  const contentLength = rangeEnd - rangeStart + 1;

  response.writeHead(206, {
    'accept-ranges': 'bytes',
    'content-length': contentLength,
    'content-range': `bytes ${rangeStart}-${rangeEnd}/${fileStat.size}`,
    'content-type': contentType,
    'content-disposition': `inline; filename="${path.basename(filePath).replaceAll('"', '')}"`,
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath, { start: rangeStart, end: rangeEnd });
  stream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Failed to read file');
  });
  stream.pipe(response);
}

async function resolveInlineMedia(filePath, fileStat) {
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (!VIDEO_EXTENSIONS.has(extension) || extension === 'webm') {
    return {
      path: filePath,
      stat: fileStat,
      generated: false,
    };
  }

  const processedPath = getProcessedVideoPath(filePath);
  const processedStat = await stat(processedPath).catch(() => null);

  if (processedStat?.isFile() && processedStat.mtimeMs >= fileStat.mtimeMs) {
    return {
      path: processedPath,
      stat: processedStat,
      generated: false,
    };
  }

  const activeConversion = activeVideoConversions.get(processedPath);

  if (activeConversion) {
    return activeConversion;
  }

  const conversion = createProcessedVideo(filePath, processedPath)
    .finally(() => {
      activeVideoConversions.delete(processedPath);
    });

  activeVideoConversions.set(processedPath, conversion);
  return conversion;
}

async function createProcessedVideo(sourcePath, processedPath) {
  await mkdir(path.dirname(processedPath), { recursive: true });
  const tempPath = `${processedPath}.${randomUUID()}.tmp.mp4`;
  const durationSeconds = await probeVideoDurationSeconds(sourcePath);
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, processedPath).split(path.sep).join('/');
  const startedAt = Date.now();

  logEvent('server', 'file_convert_start', {
    kind: 'video',
    source_path: sourceRelativePath,
    output_path: outputRelativePath,
  });

  videoConversionStatuses.set(processedPath, {
    state: 'pending',
    progress: 0,
    message: 'Preparing video for browser playback...',
    durationSeconds,
    updatedAt: Date.now(),
  });

  try {
    await runFfmpegVideoConversion(sourcePath, tempPath, (progress) => {
      videoConversionStatuses.set(processedPath, {
        state: 'pending',
        progress,
        message: progress >= 100 ? 'Finalizing converted video...' : 'Preparing video for browser playback...',
        durationSeconds,
        updatedAt: Date.now(),
      });
    });
    await rename(tempPath, processedPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    videoConversionStatuses.set(processedPath, {
      state: 'error',
      progress: 0,
      message: error.message,
      durationSeconds,
      updatedAt: Date.now(),
    });
    throw error;
  }

  videoConversionStatuses.set(processedPath, {
    state: 'ready',
    progress: 100,
    message: 'Video ready',
    durationSeconds,
    updatedAt: Date.now(),
  });
  logEvent('server', 'file_convert_end', {
    kind: 'video',
    source_path: sourceRelativePath,
    output_path: outputRelativePath,
    elapsed_ms: Date.now() - startedAt,
  });

  return {
    path: processedPath,
    stat: await stat(processedPath),
    generated: true,
  };
}

async function getVideoPreparationStatus(filePath, fileStat) {
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (!VIDEO_EXTENSIONS.has(extension) || extension === 'webm') {
    return {
      ready: true,
      requiresConversion: false,
      progress: 100,
      message: 'Video ready',
      error: '',
    };
  }

  const processedPath = getProcessedVideoPath(filePath);
  const processedStat = await stat(processedPath).catch(() => null);

  if (processedStat?.isFile() && processedStat.mtimeMs >= fileStat.mtimeMs) {
    return {
      ready: true,
      requiresConversion: true,
      progress: 100,
      message: 'Video ready',
      error: '',
    };
  }

  if (!activeVideoConversions.has(processedPath)) {
    const conversion = createProcessedVideo(filePath, processedPath)
      .finally(() => {
        activeVideoConversions.delete(processedPath);
      });
    activeVideoConversions.set(processedPath, conversion);
  }

  const status = videoConversionStatuses.get(processedPath);
  return {
    ready: false,
    requiresConversion: true,
    progress: status?.progress ?? 0,
    message: status?.message ?? 'Preparing video for browser playback...',
    error: status?.state === 'error' ? status.message : '',
  };
}

function runFfmpegVideoConversion(sourcePath, targetPath, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-progress', 'pipe:2',
      '-nostats',
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      targetPath,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let stderrBuffer = '';
    let durationSeconds = null;

    const reportProgress = (value) => {
      if (typeof onProgress === 'function') {
        onProgress(value);
      }
    };

    const handleProgressLine = (line) => {
      if (!line) {
        return;
      }

      const durationMatch = /^Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);

      if (durationMatch) {
        durationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        return;
      }

      const [key, rawValue] = line.split('=', 2);

      if (!key || typeof rawValue === 'undefined') {
        return;
      }

      if ((key === 'out_time_us' || key === 'out_time_ms') && durationSeconds && durationSeconds > 0) {
        const currentSeconds = Number(rawValue) / 1000000;

        if (Number.isFinite(currentSeconds)) {
          reportProgress(Math.max(0, Math.min(99, Math.round((currentSeconds / durationSeconds) * 100))));
        }
        return;
      }

      if (key === 'progress' && rawValue === 'end') {
        reportProgress(100);
      }
    };

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;

      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        handleProgressLine(line.trim());
      }
    });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('ffmpeg is required to generate browser-playable video files.'));
        return;
      }

      reject(error);
    });

    child.on('exit', (code) => {
      if (stderrBuffer) {
        handleProgressLine(stderrBuffer.trim());
      }

      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim().split('\n').at(-1) ?? '';
      reject(new Error(detail || `ffmpeg exited with code ${code}`));
    });
  });
}

function probeVideoDurationSeconds(sourcePath) {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      sourcePath,
    ], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('error', () => resolve(null));
    child.on('exit', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const durationSeconds = Number(output.trim());
      resolve(Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null);
    });
  });
}

function getProcessedVideoPath(filePath) {
  return path.join(path.dirname(filePath), PROCESSED_DIR_NAME, `${path.parse(filePath).name}.mp4`);
}

async function ensureImageThumbnail(sourcePath, sourceStat) {
  const thumbnailPath = getImageThumbnailPath(sourcePath);
  const thumbnailParentDir = path.dirname(thumbnailPath);
  const thumbnailStat = await stat(thumbnailPath).catch(() => null);

  if (thumbnailStat?.isFile() && thumbnailStat.mtimeMs >= sourceStat.mtimeMs) {
    return { path: thumbnailPath, generated: false };
  }

  await mkdir(thumbnailParentDir, { recursive: true });
  await createImageThumbnail(sourcePath, thumbnailPath);
  return { path: thumbnailPath, generated: true };
}

async function ensureVideoThumbnail(sourcePath, sourceStat) {
  const thumbnailPath = getVideoThumbnailPath(sourcePath);
  const thumbnailParentDir = path.dirname(thumbnailPath);
  const thumbnailStat = await stat(thumbnailPath).catch(() => null);

  if (thumbnailStat?.isFile() && thumbnailStat.mtimeMs >= sourceStat.mtimeMs) {
    return { path: thumbnailPath, generated: false };
  }

  await mkdir(thumbnailParentDir, { recursive: true });
  await createVideoThumbnail(sourcePath, thumbnailPath);
  return { path: thumbnailPath, generated: true };
}

async function createImageThumbnail(sourcePath, thumbnailPath) {
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, thumbnailPath).split(path.sep).join('/');
  const startedAt = Date.now();

  logEvent('server', 'thumbnail_generate_start', {
    kind: 'image',
    source_path: sourceRelativePath,
    output_path: outputRelativePath,
  });

  await sharp(sourcePath, { pages: 1 })
    .rotate()
    .resize(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toFile(thumbnailPath);

  logEvent('server', 'thumbnail_generate_end', {
    kind: 'image',
    source_path: sourceRelativePath,
    output_path: outputRelativePath,
    elapsed_ms: Date.now() - startedAt,
  });
}

function createVideoThumbnail(sourcePath, thumbnailPath) {
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, thumbnailPath).split(path.sep).join('/');
  const startedAt = Date.now();

  logEvent('server', 'thumbnail_generate_start', {
    kind: 'video',
    source_path: sourceRelativePath,
    output_path: outputRelativePath,
  });

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-vf', `thumbnail,scale=${THUMBNAIL_MAX_WIDTH}:${THUMBNAIL_MAX_HEIGHT}:force_original_aspect_ratio=decrease`,
      '-frames:v', '1',
      '-q:v', String(VIDEO_THUMBNAIL_QUALITY),
      thumbnailPath,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('ffmpeg is required to generate video thumbnails.'));
        return;
      }

      reject(error);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        const detail = stderr.trim().split('\n').at(-1) ?? '';
        reject(new Error(detail || `ffmpeg exited with code ${code}`));
        return;
      }

      logEvent('server', 'thumbnail_generate_end', {
        kind: 'video',
        source_path: sourceRelativePath,
        output_path: outputRelativePath,
        elapsed_ms: Date.now() - startedAt,
      });
      resolve();
    });
  });
}

function getImageThumbnailPath(sourcePath) {
  return path.join(
    path.dirname(sourcePath),
    THUMBNAIL_DIR_NAME,
    path.parse(sourcePath).name + '.jpg',
  );
}

function getVideoThumbnailPath(sourcePath) {
  const parsed = path.parse(sourcePath);
  return path.join(
    path.dirname(sourcePath),
    THUMBNAIL_DIR_NAME,
    `${parsed.name}.${parsed.ext.replace(/^\./, '').toLowerCase()}.jpg`,
  );
}

function getSharpInputExtensions() {
  const extensions = new Set();

  for (const format of Object.values(sharp.format)) {
    if (!format.input?.file) {
      continue;
    }

    for (const suffix of format.input.fileSuffix ?? []) {
      extensions.add(suffix.replace(/^\./, '').toLowerCase());
    }
  }

  return extensions;
}

function logThumbnailSupportWarning() {
  if (!THUMBNAIL_UNSUPPORTED_EXTENSIONS.length) {
    return;
  }

  logEvent('server', 'thumbnail_support_warning', {
    unsupported_extensions: THUMBNAIL_UNSUPPORTED_EXTENSIONS,
  });
}

function getInlineContentType(filePath) {
  switch (path.extname(filePath).slice(1).toLowerCase()) {
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    case 'm4v':
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'mpeg':
    case 'mpg':
      return 'video/mpeg';
    case 'png':
      return 'image/png';
    case 'svg':
      return 'image/svg+xml';
    case 'webm':
      return 'video/webm';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function parsePageSize(value) {
  if (value === 'All') {
    return 'All';
  }

  const pageSize = Number(value ?? DEFAULT_PAGE_SIZE);
  return PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

function parseCliArgs(args) {
  const options = {
    dir: '.',
    port: '3000',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '-p' || arg === '--port') {
      const value = args[index + 1];

      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }

      options.port = value;
      index += 1;
      continue;
    }

    if (arg === '-d' || arg === '--dir') {
      const value = args[index + 1];

      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }

      options.dir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parsePort(value) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function normalizeRelativeDirectory(relativeDir) {
  const normalizedPath = path.posix.normalize(`/${relativeDir}`).replace(/^\//, '');

  if (normalizedPath === '.' || normalizedPath === '') {
    return '';
  }

  if (normalizedPath.startsWith('..')) {
    throw new Error('Invalid directory path');
  }

  return normalizedPath;
}

function resolveRootRelativePath(relativePath) {
  const normalizedPath = path.normalize(relativePath);

  if (rootDirs.length > 1) {
    const parts = normalizedPath.split(path.sep);
    const rootName = parts[0];
    const rootEntry = rootDirs.find(d => path.basename(d) === rootName);

    if (rootEntry) {
      const remainingPath = parts.slice(1).join(path.sep);
      const resolvedPath = remainingPath
        ? path.resolve(rootEntry, remainingPath)
        : rootEntry;
      const relativeToEntry = path.relative(rootEntry, resolvedPath);

      if (relativeToEntry.startsWith('..') || path.isAbsolute(relativeToEntry)) {
        throw new Error('Invalid file path');
      }

      return resolvedPath;
    }
  }

  const resolvedPath = path.resolve(rootDir, normalizedPath);
  const relativeToRoot = path.relative(rootDir, resolvedPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Invalid file path');
  }

  return resolvedPath;
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const probe = createNetServer();

      probe.once('error', (error) => {
        probe.close();

        if (error.code === 'EADDRINUSE') {
          tryPort(port + 1);
          return;
        }

        reject(error);
      });

      probe.once('listening', () => {
        probe.close(() => resolve(port));
      });

      probe.listen(port, '127.0.0.1');
    };

    tryPort(startPort);
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function saveMultipartFiles(body, boundary, destinationDir, options = {}) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from('\r\n\r\n');
  const uploaded = [];
  const overwriteExisting = options.overwriteExisting === true;
  const onFileSaved = typeof options.onFileSaved === 'function' ? options.onFileSaved : null;
  let offset = 0;

  while (offset < body.length) {
    const boundaryIndex = body.indexOf(boundaryBuffer, offset);

    if (boundaryIndex === -1) {
      break;
    }

    const nextOffset = boundaryIndex + boundaryBuffer.length;
    const trailer = body.slice(nextOffset, nextOffset + 2).toString();

    if (trailer === '--') {
      break;
    }

    offset = nextOffset + 2;
    const headerEnd = body.indexOf(delimiter, offset);

    if (headerEnd === -1) {
      break;
    }

    const headerText = body.slice(offset, headerEnd).toString('utf8');
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    const contentStart = headerEnd + delimiter.length;
    const nextBoundary = body.indexOf(boundaryBuffer, contentStart);

    if (nextBoundary === -1) {
      break;
    }

    const contentEnd = nextBoundary - 2;
    const fileContent = body.slice(contentStart, contentEnd);
    offset = nextBoundary;

    if (!filenameMatch?.[1]) {
      continue;
    }

    const originalName = normalizeUploadFileName(filenameMatch[1]);
    const targetPath = await resolveUploadTargetPath(destinationDir, originalName, overwriteExisting);

    await writeFile(targetPath, fileContent);
    uploaded.push(path.basename(targetPath));

    if (onFileSaved) {
      onFileSaved({
        fileName: path.basename(targetPath),
        size: fileContent.length,
      });
    }
  }

  return uploaded;
}

async function resolveUploadTargetPath(destinationDir, originalName, overwriteExisting) {
  const candidate = path.join(destinationDir, originalName);

  if (overwriteExisting || !(await fileExists(candidate))) {
    return candidate;
  }

  const error = new Error(`File already exists: ${originalName}`);
  error.code = 'EFILEEXISTS';
  error.suggestedName = await suggestAvailableFileName(destinationDir, originalName);
  throw error;
}

async function suggestAvailableFileName(destinationDir, originalName) {
  const parsed = path.parse(originalName);
  let index = 1;

  while (true) {
    const candidateName = `${parsed.name} (${index})${parsed.ext}`;

    if (!(await fileExists(path.join(destinationDir, candidateName)))) {
      return candidateName;
    }

    index += 1;
  }
}

async function fileExists(filePath) {
  const fileStat = await stat(filePath).catch(() => null);
  return fileStat?.isFile() ?? false;
}

function normalizeUploadFileName(value) {
  const fileName = path.basename(String(value || '')).trim();

  if (!fileName || fileName === '.' || fileName === '..') {
    throw new Error('Invalid file name');
  }

  return fileName;
}

async function createZipArchive(cwd, archivePath, selectedItems) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    (async () => {
      for (const item of selectedItems) {
        const sourcePath = path.join(cwd, item);
        const itemStat = await stat(sourcePath);

        if (itemStat.isDirectory()) {
          archive.directory(sourcePath, item);
        } else {
          archive.file(sourcePath, { name: item });
        }
      }

      await archive.finalize();
    })().catch(reject);
  });
}

function formatTimestamp(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function logAccess(request, action, details) {
  logEvent(getRequestIp(request), action, details);
}

function logEvent(ip, action, details = {}) {
  const timestamp = new Date().toISOString();
  const level = 'INFO';
  const serializedDetails = Object.entries(details)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  console.log(`${timestamp} ${level} ip=${ip || 'unknown'} action=${action}${serializedDetails ? ` ${serializedDetails}` : ''}`);
}

function getRequestIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.socket.remoteAddress || 'unknown';
}

function registerShutdownHandlers(server) {
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logEvent('server', 'shutdown', {
      signal,
      active_sessions: activeSessions.size,
    });

    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function resolveListedFilePath(relativePath) {
  return resolveRootRelativePath(relativePath);
}

function resolveListedDirectoryPath(relativePath) {
  const directoryPath = resolveListedFilePath(relativePath || '.');
  return directoryPath;
}

function resolveUploadDirectoryPath(currentDir) {
  return resolveListedDirectoryPath(path.posix.join(currentDir, appConfig.uploadDir));
}

function resolveCurrentDirectoryEntryPath(currentDir, relativePath) {
  const entryPath = resolveListedFilePath(relativePath);
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const relativeToCurrentDirectory = path.relative(currentDirectoryPath, entryPath);

  if (relativeToCurrentDirectory.startsWith('..') || path.isAbsolute(relativeToCurrentDirectory)) {
    throw new Error('Selection is only allowed inside the current directory');
  }

  return entryPath;
}

function isUploadSubtreePath(currentDir, relativePath) {
  const normalizedPath = normalizeRelativeDirectory(relativePath);
  const uploadDirPath = normalizeRelativeDirectory(path.posix.join(currentDir, appConfig.uploadDir));

  if (!normalizedPath || !uploadDirPath) {
    return false;
  }

  return normalizedPath === uploadDirPath || normalizedPath.startsWith(uploadDirPath + '/');
}

function renderPage(config) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>File Manager</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    [x-cloak] {
      display: none !important;
    }

    button,
    [role="button"],
    a {
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
    }

    .icon-action {
      position: relative;
      display: inline-flex;
    }

    .icon-action-tooltip {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 0.6rem);
      transform: translateX(-50%) translateY(0.25rem);
      pointer-events: none;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 150ms ease, transform 150ms ease;
    }

    .icon-action:hover .icon-action-tooltip,
    .icon-action:focus-within .icon-action-tooltip {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  </style>
</head>
  <body x-data="fileManagerApp()" @keydown.window="onGlobalKeydown($event)" @resize.window="onViewportResize()" class="min-h-screen bg-slate-950 text-slate-100">
  <div id="loginShell" x-cloak x-show="showLoginShell" class="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
    <div class="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center justify-center">
      <section class="w-full rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/50">
        <div class="mb-6">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Protected Access</p>
          <h1 class="mt-3 text-3xl font-semibold tracking-tight text-slate-100">File Manager Login</h1>
          <p class="mt-2 text-sm text-slate-400">Sign in to access the file browser. Sessions expire after 10 minutes.</p>
        </div>
        <form id="loginForm" @submit.prevent="onLoginSubmit($event)" class="space-y-4">
          <label class="block text-sm text-slate-300">
            <span class="mb-2 block">Username</span>
            <input id="usernameInput" x-model="loginUsername" x-init="$watch('showLoginShell', (value) => { if (value) { $nextTick(() => $el.focus()); } })" name="username" type="text" autocomplete="username" class="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500" required>
          </label>
          <label class="block text-sm text-slate-300">
            <span class="mb-2 block">Password</span>
            <div class="relative">
              <input id="passwordInput" x-model="loginPassword" :type="passwordVisible ? 'text' : 'password'" name="password" autocomplete="current-password" class="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 pr-14 text-slate-100 outline-none transition focus:border-cyan-500" required>
              <button id="passwordToggle" @click="onTogglePassword()" :aria-label="passwordVisible ? 'Hide password' : 'Show password'" :aria-pressed="passwordVisible ? 'true' : 'false'" type="button" class="absolute inset-y-0 right-2 my-2 inline-flex w-10 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300">
                <template x-if="passwordVisible">
                  <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l1.845 1.845A8.977 8.977 0 0 0 1.6 9.697a1 1 0 0 0 0 .606 8.02 8.02 0 0 0 12.513 4.152l2.607 2.607a.75.75 0 1 0 1.06-1.06l-14.5-14.5Zm7.63 7.63a2.75 2.75 0 0 1-3.76-3.76l3.76 3.76Zm2.128 2.128A6.52 6.52 0 0 1 3.1 10a7.49 7.49 0 0 1 2.04-3.205l1.036 1.036a4.25 4.25 0 0 0 6 6l.862.862Zm1.822-1.822-1.03-1.03a4.25 4.25 0 0 0-5.956-5.956l-1.03-1.03A8.018 8.018 0 0 1 18.4 9.697a1 1 0 0 1 0 .606 7.934 7.934 0 0 1-3.54 3.853Z" />
                  </svg>
                </template>
                <template x-if="!passwordVisible">
                  <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M1.6 10.303a1 1 0 0 1 0-.606 8.02 8.02 0 0 1 14.8-1.98.75.75 0 1 1-1.298.752 6.52 6.52 0 0 0-12.002 1.531 6.52 6.52 0 0 0 12.002 1.531.75.75 0 0 1 1.298.752 8.02 8.02 0 0 1-14.8-1.98Z" />
                    <path d="M10 7.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z" />
                  </svg>
                </template>
              </button>
            </div>
          </label>
          <label class="flex items-center gap-3 text-sm text-slate-300">
            <input id="rememberMeInput" x-model="rememberMe" @change="onRememberMeChange()" name="rememberMe" type="checkbox" class="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-500">
            <span>Remember me</span>
          </label>
          <button id="loginButton" :disabled="loginPending" type="submit" class="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
            <span x-text="loginPending ? 'Signing in...' : 'Login'"></span>
          </button>
          <p id="loginStatus" x-text="loginStatusText" class="min-h-5 text-sm text-rose-300"></p>
        </form>
      </section>
    </div>
  </div>

  <main id="appShell" x-cloak x-show="showAppShell" class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">File Manager</h1>
        <p class="mt-2 text-sm text-slate-400">Browse files as a paginated tree, upload new files, and bundle selected files into a zip archive.</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div id="sessionInfo" x-text="sessionInfoText" class="rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300"></div>
        <div id="summary" x-text="summaryText" class="rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300"></div>
        <div class="icon-action">
          <button id="logoutButton" @click="onLogout()" x-cloak x-show="authEnabled" type="button" aria-label="Log out" class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-100 transition hover:border-rose-500 hover:text-rose-200">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M3.75 4.5A2.25 2.25 0 0 1 6 2.25h4a.75.75 0 0 1 0 1.5H6A.75.75 0 0 0 5.25 4.5v11A.75.75 0 0 0 6 16.25h4a.75.75 0 0 1 0 1.5H6a2.25 2.25 0 0 1-2.25-2.25v-11Zm8.22 2.72a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 1 1-1.06-1.06l1.97-1.97H8.75a.75.75 0 0 1 0-1.5h5.19l-1.97-1.97a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
            </svg>
          </button>
          <span class="icon-action-tooltip rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-100 shadow-lg">Log Out</span>
        </div>
      </div>
    </div>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <div id="breadcrumbs" class="flex flex-wrap items-center gap-2">
            <template x-for="(item, index) in breadcrumbs" :key="item.path || 'root'">
              <div class="flex items-center gap-2">
                <button type="button" class="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300" @click="navigate(item.path)" x-text="item.label"></button>
                <span x-show="index < breadcrumbs.length - 1" class="text-slate-600">/</span>
              </div>
            </template>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <div id="viewModeControls" class="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1">
            <button id="listViewButton" @click="onSetViewMode('list')" :class="viewModeButtonClass('list')" type="button" aria-label="List view" title="List view">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.75 4.5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm5-10a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Z" />
              </svg>
            </button>
            <button id="gridViewButton" @click="onSetViewMode('grid')" :class="viewModeButtonClass('grid')" type="button" aria-label="Grid view" title="Grid view">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.75 3.75A1.75 1.75 0 0 1 5.5 2h3A1.75 1.75 0 0 1 10.25 3.75v3A1.75 1.75 0 0 1 8.5 8.5h-3A1.75 1.75 0 0 1 3.75 6.75v-3Zm0 9.5A1.75 1.75 0 0 1 5.5 11.5h3a1.75 1.75 0 0 1 1.75 1.75v3A1.75 1.75 0 0 1 8.5 18h-3a1.75 1.75 0 0 1-1.75-1.75v-3ZM11.5 3.75A1.75 1.75 0 0 1 13.25 2h3A1.75 1.75 0 0 1 18 3.75v3A1.75 1.75 0 0 1 16.25 8.5h-3a1.75 1.75 0 0 1-1.75-1.75v-3Zm0 9.5a1.75 1.75 0 0 1 1.75-1.75h3A1.75 1.75 0 0 1 18 13.25v3A1.75 1.75 0 0 1 16.25 18h-3a1.75 1.75 0 0 1-1.75-1.75v-3Z" />
              </svg>
            </button>
          </div>
          <span id="selectedCount" x-text="selectedCountText">0 selected</span>
        </div>
      </div>

      <div id="extensionFilters" class="mt-4 flex flex-wrap gap-2">
        <template x-for="extension in availableExtensions" :key="extension">
          <button type="button" :class="extensionButtonClass(extension)" @click="toggleExtension(extension)" x-text="'.' + extension"></button>
        </template>
      </div>

      <div id="dropzone" @dragenter.prevent="onDropzoneDragEnter($event)" @dragover.prevent="onDropzoneDragEnter($event)" @dragleave.prevent="onDropzoneDragLeave($event)" @drop.prevent="onDropzoneDrop($event)" :class="dropzoneActive ? 'border-cyan-500 bg-cyan-500/5' : 'border-slate-700 bg-slate-950/60 hover:border-cyan-500 hover:bg-cyan-500/5'" class="mt-4 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition">
        <p class="text-lg font-medium text-slate-100">Drop files here or use the upload button</p>
        <p class="mt-2 text-sm text-slate-400">Uploaded files are written to the <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">${escapeHtml(config.uploadDir)}</code> directory relative to the directory you are currently browsing.</p>
        <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
          <div class="icon-action">
            <button id="uploadButton" @click="onOpenFileInput()" :disabled="uploadBusy" type="button" aria-label="Upload files" class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500 text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10 2.75a.75.75 0 0 1 .75.75v7.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L6.22 9.78a.75.75 0 0 1 1.06-1.06l1.97 1.97V3.5A.75.75 0 0 1 10 2.75ZM4.5 13.25A.75.75 0 0 1 5.25 14v1.5c0 .414.336.75.75.75h8a.75.75 0 0 0 .75-.75V14a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 14 17.75H6A2.25 2.25 0 0 1 3.75 15.5V14a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
              </svg>
            </button>
            <span class="icon-action-tooltip rounded-full border border-cyan-400/40 bg-slate-900 px-3 py-1 text-xs font-semibold text-cyan-200 shadow-lg">Upload Files</span>
          </div>
          <div class="icon-action">
            <button id="zipSelectedButton" @click="onCreateSelectionZip()" :disabled="!hasSelection || zipPending" type="button" aria-label="Zip selected items" class="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M7 2.75A1.75 1.75 0 0 0 5.25 4.5v11A1.75 1.75 0 0 0 7 17.25h6A1.75 1.75 0 0 0 14.75 15.5v-7a.75.75 0 0 0-.22-.53l-3-3A.75.75 0 0 0 11 4.75H7Zm3.25 2.56 2.94 2.94H11a.75.75 0 0 1-.75-.75V5.31Zm-1 4.19a.75.75 0 0 1 1.5 0v.25a.75.75 0 0 1-1.5 0V9.5Zm0 2.5a.75.75 0 0 1 1.5 0v.5a.75.75 0 0 1-1.5 0V12Zm0 2.75a.75.75 0 0 1 1.5 0v.25a.75.75 0 0 1-1.5 0v-.25Z" />
              </svg>
            </button>
            <span class="icon-action-tooltip rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-100 shadow-lg">Zip Selected Items</span>
          </div>
          <div class="icon-action">
            <button id="deleteSelectedButton" @click="onDeleteSelectedFiles()" :disabled="!hasSelection || deletePending" type="button" aria-label="Delete selected items" class="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-900 bg-rose-950/40 text-rose-200 transition hover:border-rose-500 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M8.75 2.75a1.75 1.75 0 0 0-1.67 1.23L6.89 4.5H4.5a.75.75 0 0 0 0 1.5h.44l.83 9.12A2.25 2.25 0 0 0 8.01 17.25h3.98a2.25 2.25 0 0 0 2.24-2.13l.83-9.12h.44a.75.75 0 0 0 0-1.5h-2.39l-.19-.52a1.75 1.75 0 0 0-1.67-1.23h-2.5Zm-.08 3.25-.8 8.85a.75.75 0 0 0 1.49.14L10.16 6h-.49l.8 8.99a.75.75 0 1 0 1.49-.14l-.8-8.85H8.67Z" clip-rule="evenodd" />
              </svg>
            </button>
            <span class="icon-action-tooltip rounded-full border border-rose-900 bg-slate-900 px-3 py-1 text-xs font-semibold text-rose-100 shadow-lg">Delete Selected Items</span>
          </div>
        </div>
        <template x-for="token in [fileInputVersion]" :key="token">
          <input :id="'fileInput-' + token" x-init="$watch('fileInputOpenToken', () => { if (!uploadBusy) { $el.click(); } })" @change="onFileInputChange($event)" :disabled="uploadBusy" type="file" multiple class="hidden">
        </template>
        <div id="uploadProgress" x-cloak x-show="uploadProgressVisible" class="mx-auto mt-5 max-w-md text-left">
          <div class="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
            <span id="uploadProgressLabel" x-text="uploadProgressLabel">Uploading...</span>
            <span id="uploadProgressValue" x-text="uploadProgressValue">0%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-slate-800">
            <div id="uploadProgressBar" :style="{ width: uploadProgressWidth }" class="h-full w-0 rounded-full bg-cyan-500 transition-[width] duration-150"></div>
          </div>
        </div>
      </div>

      <div id="status" x-text="statusText" class="mt-4 text-sm text-slate-400"></div>

      <div id="directoryView" class="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
        <div x-show="directories.length === 0 && files.length === 0">No items in this directory.</div>

        <template x-if="viewMode === 'list' && (directories.length || files.length)">
          <div class="space-y-3">
            <template x-for="directory in directories" :key="'dir-' + directory.path">
              <div class="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 transition hover:border-cyan-500 hover:bg-slate-900">
                <input class="selection-checkbox size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" :checked="isSelected(directory.path)" @change="toggleFileSelection(directory.path, $event.target.checked)">
                <button type="button" class="flex min-w-0 flex-1 items-center justify-between text-left" @click="navigate(directory.path)">
                  <span class="min-w-0 truncate font-semibold text-cyan-300" x-text="directory.name + '/'"></span>
                  <span class="text-xs text-slate-500">Folder</span>
                </button>
              </div>
            </template>

            <template x-for="file in files" :key="'file-list-' + file.path">
              <label class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 hover:bg-slate-900/60">
                <input class="selection-checkbox size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" :checked="isSelected(file.path)" @change="toggleFileSelection(file.path, $event.target.checked)">
                <button x-show="isZip(file.extension)" type="button" class="min-w-0 flex-1 truncate text-left text-slate-100 underline-offset-4 transition hover:text-cyan-300 hover:underline" @click="openArchive(file.path, $event)" x-text="file.name"></button>
                <a x-show="!isZip(file.extension)" class="min-w-0 flex-1 truncate text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline" :href="downloadUrl(file)" x-text="file.name"></a>
                <span class="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400" x-text="'.' + (file.extension || 'none')"></span>
                <span class="text-xs text-slate-400" x-text="formatBytesValue(file.size)"></span>
                <span class="text-xs text-slate-500" x-text="formatDateValue(file.modifiedAt)"></span>
              </label>
            </template>
          </div>
        </template>

        <template x-if="viewMode === 'grid' && (directories.length || files.length)">
          <div class="space-y-6">
            <template x-if="directories.length">
              <div>
                <p class="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Folders</p>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <template x-for="directory in directories" :key="'dir-grid-' + directory.path">
                    <div class="relative">
                      <input class="selection-checkbox absolute left-3 top-3 z-10 size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" :checked="isSelected(directory.path)" @change="toggleFileSelection(directory.path, $event.target.checked)">
                      <button type="button" class="flex min-h-28 w-full flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-4 pl-10 text-left transition hover:border-cyan-500 hover:bg-slate-900" @click="navigate(directory.path)">
                        <span class="text-3xl">&#128193;</span>
                        <div>
                          <p class="truncate font-semibold text-cyan-300" x-text="directory.name"></p>
                          <p class="mt-1 text-xs text-slate-500">Open folder</p>
                        </div>
                      </button>
                    </div>
                  </template>
                </div>
              </div>
            </template>

            <template x-if="files.length">
              <div>
                <p class="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Files</p>
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  <template x-for="file in files" :key="'file-grid-' + file.path">
                    <label class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 transition hover:border-cyan-500 hover:bg-slate-900/70">
                      <div class="group relative">
                        <div class="aspect-[4/3] bg-slate-950">
                          <template x-if="isImage(file.extension)">
                            <img class="h-full w-full object-cover" :src="thumbnailUrl(file)" :alt="file.name" loading="lazy">
                          </template>
                          <template x-if="!isImage(file.extension) && isVideo(file.extension)">
                            <div class="h-full w-full" x-init="prepareGridVideo(file)">
                              <template x-if="gridVideoReady(file)">
                                <video class="h-full w-full object-cover" :src="gridVideoUrl(file)" :poster="thumbnailUrl(file)" :data-video-path="file.path" data-shared-video="grid" @play="onSharedVideoPlay(file.path, 'grid', $event)" @pause="onSharedVideoPause(file.path, 'grid', $event)" @timeupdate="onSharedVideoTimeUpdate(file.path, $event)" @seeked="onSharedVideoSeeked(file.path, $event)" @loadedmetadata="onSharedVideoLoadedMetadata(file.path, 'grid', $event)" @ended="onSharedVideoEnded(file.path, 'grid', $event)" controls playsinline preload="metadata"></video>
                              </template>
                              <template x-if="!gridVideoReady(file)">
                                <div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                                  <p class="text-sm font-semibold text-slate-100" x-text="gridVideoProgressLabel(file)"></p>
                                  <div class="h-2 w-full max-w-[12rem] overflow-hidden rounded-full bg-slate-800">
                                    <div :style="{ width: gridVideoProgressWidth(file) }" class="h-full w-0 rounded-full bg-cyan-500 transition-[width] duration-300"></div>
                                  </div>
                                  <p class="text-xs text-slate-400" x-text="gridVideoProgressValue(file)"></p>
                                  <p class="min-h-4 text-xs text-rose-300" x-text="gridVideoError(file)"></p>
                                </div>
                              </template>
                            </div>
                          </template>
                          <template x-if="!isImage(file.extension) && !isVideo(file.extension)">
                            <div class="flex h-full items-center justify-center text-4xl text-slate-500" x-text="'.' + (file.extension || 'file')"></div>
                          </template>
                        </div>
                        <button x-show="isImage(file.extension)" type="button" aria-label="Open media viewer" class="absolute right-3 top-3 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-100 shadow-lg transition hover:border-cyan-500 hover:text-cyan-300 group-hover:flex" @click="openMedia(file.path, $event)">
                          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fill-rule="evenodd" d="M12.25 3.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75V7a.75.75 0 0 1-1.5 0V5.31l-4.22 4.22a.75.75 0 1 1-1.06-1.06l4.22-4.22H13a.75.75 0 0 1-.75-.75Zm-4.5 13a.75.75 0 0 1-.75.75H3.5a.75.75 0 0 1-.75-.75V13a.75.75 0 0 1 1.5 0v1.69l4.22-4.22a.75.75 0 0 1 1.06 1.06l-4.22 4.22H7a.75.75 0 0 1 .75.75Zm8.75-3.5a.75.75 0 0 1 .75.75v2.75a.75.75 0 0 1-.75.75h-2.75a.75.75 0 0 1 0-1.5h1.69l-4.22-4.22a.75.75 0 0 1 1.06-1.06l4.22 4.22V13.75a.75.75 0 0 1 .75-.75Zm-13-9.5a.75.75 0 0 1 .75-.75H7a.75.75 0 0 1 0 1.5H5.31l4.22 4.22a.75.75 0 1 1-1.06 1.06L4.25 5.31V7a.75.75 0 0 1-1.5 0V3.5Z" clip-rule="evenodd" />
                          </svg>
                        </button>
                        <button x-show="isZip(file.extension)" type="button" aria-label="Open archive viewer" class="absolute right-3 top-3 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-100 shadow-lg transition hover:border-cyan-500 hover:text-cyan-300 group-hover:flex" @click="openArchive(file.path, $event)">
                          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fill-rule="evenodd" d="M5.5 2.75A1.75 1.75 0 0 0 3.75 4.5v11c0 .966.784 1.75 1.75 1.75h9A1.75 1.75 0 0 0 16.25 15.5v-7a.75.75 0 0 0-.22-.53l-3-3a.75.75 0 0 0-.53-.22h-7Zm6 .56 2.94 2.94H12.25a.75.75 0 0 1-.75-.75V3.31Zm-1.25 4.94a.75.75 0 0 1 .75.75v1h1a.75.75 0 0 1 0 1.5h-1v1a.75.75 0 0 1-1.5 0v-1h-1a.75.75 0 0 1 0-1.5h1v-1a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
                          </svg>
                        </button>
                        <input class="selection-checkbox absolute left-3 top-3 size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" :checked="isSelected(file.path)" @change="toggleFileSelection(file.path, $event.target.checked)">
                      </div>
                        <div class="space-y-2 p-4">
                          <button x-show="isZip(file.extension)" type="button" class="block w-full truncate text-left font-semibold text-slate-100 underline-offset-4 transition hover:text-cyan-300 hover:underline" @click="openArchive(file.path, $event)" x-text="file.name"></button>
                          <a x-show="!isZip(file.extension)" class="block truncate font-semibold text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline" :href="downloadUrl(file)" x-text="file.name"></a>
                          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span class="rounded-full border border-slate-700 px-2 py-1" x-text="'.' + (file.extension || 'none')"></span>
                            <span x-text="formatBytesValue(file.size)"></span>
                            <span x-show="isImage(file.extension) && formatDimensionsValue(file)" x-text="formatDimensionsValue(file)"></span>
                            <span x-text="formatDateValue(file.modifiedAt)"></span>
                          </div>
                        </div>
                    </label>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <div class="icon-action">
          <button id="prevButton" @click="onChangePageBy(-1)" :disabled="!canGoPrev" type="button" aria-label="Previous page" class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 font-semibold text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M11.78 4.22a.75.75 0 0 1 0 1.06L7.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
            </svg>
          </button>
          <span class="icon-action-tooltip rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-100 shadow-lg">Previous Page</span>
        </div>
        <span>Page</span>
        <input id="pageInput" x-model="pageInputValue" :max="pageInputMax" @change="onSubmitCurrentPageInput()" @keydown.enter.prevent="onSubmitCurrentPageInput()" type="number" min="1" class="w-20 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-0">
        <span>of</span>
        <span id="pageInfo" x-text="pageInfoText" class="text-slate-400"></span>
        <div class="icon-action">
          <button id="nextButton" @click="onChangePageBy(1)" :disabled="!canGoNext" type="button" aria-label="Next page" class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 font-semibold text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M8.22 15.78a.75.75 0 0 1 0-1.06L12.94 10 8.22 5.28a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0Z" clip-rule="evenodd" />
            </svg>
          </button>
          <span class="icon-action-tooltip rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-100 shadow-lg">Next Page</span>
        </div>
        <div class="flex items-center gap-2">
          <span>Page size</span>
          <div class="relative" @keydown.escape.prevent.stop="onClosePageSizeMenu()">
            <button id="pageSize" @click="onTogglePageSizeMenu()" type="button" aria-haspopup="listbox" :aria-expanded="pageSizeMenuOpen ? 'true' : 'false'" class="inline-flex min-w-24 items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition hover:border-cyan-500">
              <span x-text="pageSizeLabel()"></span>
              <svg class="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
              </svg>
            </button>
            <div x-cloak x-show="pageSizeMenuOpen" @click.outside="onClosePageSizeMenu()" class="absolute right-0 z-20 mt-2 w-32 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
              <template x-for="option in pageSizeOptions" :key="String(option)">
                <button @click="onSelectPageSize(option)" type="button" :class="pageSizeOptionClass(option)" class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition">
                  <span x-text="String(option)"></span>
                  <svg x-show="String(option) === pageSizeValue" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M16.704 5.29a.75.75 0 0 1 .006 1.06l-8 8.091a.75.75 0 0 1-1.074 0l-4-4.045a.75.75 0 0 1 1.068-1.054l3.463 3.503 7.467-7.55a.75.75 0 0 1 1.06-.005Z" clip-rule="evenodd" />
                  </svg>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <div id="lightboxOverlay" @click.self="onCloseLightbox()" x-cloak x-show="lightboxOpen" class="fixed inset-0 z-50 bg-slate-950/95 px-2 py-3 sm:px-3 sm:py-4 lg:px-6">
    <button id="lightboxCloseButton" @click="onCloseLightbox()" type="button" aria-label="Close media viewer" class="absolute right-4 top-4 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 sm:right-6 sm:top-6">
      <svg class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
      </svg>
    </button>
    <div id="lightboxShell" class="mx-auto flex h-full w-full max-w-[min(88vw,1680px)] flex-col gap-2 xl:max-w-[min(calc(100vw-12rem),1680px)]">
      <div id="lightboxHeader" class="shrink-0 rounded-2xl border border-slate-800 bg-slate-900/85 px-4 py-2.5 backdrop-blur">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p id="lightboxTitle" x-text="lightboxTitleValue" class="min-w-0 truncate font-semibold text-slate-100"></p>
              <div id="lightboxMeta" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                <template x-for="item in lightboxMetaItems" :key="item.key">
                  <span :class="item.badge ? 'rounded-full border border-slate-700 px-2 py-1' : ''" x-text="item.text"></span>
                </template>
              </div>
            </div>
          </div>
          <div x-cloak x-show="lightboxMode === 'image'" class="flex shrink-0 items-center gap-2 text-sm text-slate-300">
            <button @click="onLightboxZoomOut()" :disabled="lightboxZoomOutDisabled" :class="{ 'opacity-40': lightboxZoomOutDisabled }" type="button" aria-label="Zoom out" class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M4 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 10Z" clip-rule="evenodd" />
              </svg>
            </button>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Zoom</span>
              <div class="relative" @keydown.escape.prevent.stop="onCloseLightboxZoomMenu()">
                <button @click="onToggleLightboxZoomMenu()" type="button" aria-haspopup="listbox" :aria-expanded="lightboxZoomMenuOpen ? 'true' : 'false'" class="inline-flex min-w-28 items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-cyan-500">
                  <span x-text="lightboxZoomLabel()"></span>
                  <svg class="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
                  </svg>
                </button>
                <div x-cloak x-show="lightboxZoomMenuOpen" @click.outside="onCloseLightboxZoomMenu()" class="absolute right-0 z-20 mt-2 max-h-72 w-32 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
                  <template x-for="option in lightboxZoomOptions" :key="option.value">
                    <button @click="onSelectLightboxZoom(option.value)" type="button" :class="lightboxZoomOptionClass(option)" class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition">
                      <span x-text="option.label"></span>
                      <svg x-show="option.value === lightboxZoomValue" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M16.704 5.29a.75.75 0 0 1 .006 1.06l-8 8.091a.75.75 0 0 1-1.074 0l-4-4.045a.75.75 0 0 1 1.068-1.054l3.463 3.503 7.467-7.55a.75.75 0 0 1 1.06-.005Z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </template>
                </div>
              </div>
            </div>
            <button @click="onLightboxZoomIn()" :disabled="lightboxZoomInDisabled" :class="{ 'opacity-40': lightboxZoomInDisabled }" type="button" aria-label="Zoom in" class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M10 4a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 10 4Z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div id="lightboxBackdrop" @click.self="onLightboxBackdropClick($event)" @pointerdown="onLightboxPointerDown($event)" @pointermove="onLightboxPointerMove($event)" @pointerup="onLightboxPointerUp($event)" @pointercancel="onLightboxPointerUp($event)" class="min-h-0 flex-1" :class="lightboxBackdropClass()">
        <div class="flex min-h-full min-w-full items-center justify-center">
          <img id="lightboxImage" x-cloak x-show="lightboxMode === 'image'" @load="onLightboxImageLoad($event)" :src="lightboxImageUrl" :alt="lightboxImageAlt" :style="lightboxImageStyle" class="block max-w-none shrink-0">
          <div x-cloak x-show="lightboxMode === 'video' && !lightboxVideoReady" class="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/50">
            <p class="text-lg font-semibold text-slate-100" x-text="lightboxVideoProgressLabel"></p>
            <p class="mt-2 text-sm text-slate-400" x-text="lightboxVideoProgressValue"></p>
            <div class="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
              <div :style="{ width: lightboxVideoProgressWidth }" class="h-full w-0 rounded-full bg-cyan-500 transition-[width] duration-300"></div>
            </div>
            <p class="mt-4 min-h-5 text-sm text-rose-300" x-text="lightboxVideoErrorText"></p>
          </div>
          <video id="lightboxVideo" x-cloak x-show="lightboxMode === 'video' && lightboxVideoReady" :src="lightboxVideoUrl" :data-video-path="lightboxPathValue" data-shared-video="lightbox" :style="lightboxVideoStyle" @play="onSharedVideoPlay(lightboxPathValue, 'lightbox', $event)" @pause="onSharedVideoPause(lightboxPathValue, 'lightbox', $event)" @timeupdate="onSharedVideoTimeUpdate(lightboxPathValue, $event)" @seeked="onSharedVideoSeeked(lightboxPathValue, $event)" @loadedmetadata="onSharedVideoLoadedMetadata(lightboxPathValue, 'lightbox', $event)" @ended="onSharedVideoEnded(lightboxPathValue, 'lightbox', $event)" class="max-h-full max-w-full" controls playsinline preload="none"></video>
          <div x-cloak x-show="lightboxMode === 'zip'" class="w-full max-w-5xl rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-2xl shadow-slate-950/50 sm:p-5">
            <div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
              <template x-for="item in lightboxZipBreadcrumbs" :key="'zip-breadcrumb-' + item.path">
                <div class="flex items-center gap-2">
                  <button type="button" class="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300" @click="navigateArchiveDirectory(item.path)" x-text="item.label"></button>
                  <span class="text-slate-600">/</span>
                </div>
              </template>
            </div>
            <p x-cloak x-show="lightboxZipLoading" class="py-8 text-sm text-slate-400">Reading archive contents...</p>
            <p x-cloak x-show="!lightboxZipLoading && lightboxZipErrorText" class="py-8 text-sm text-rose-300" x-text="lightboxZipErrorText"></p>
            <div x-cloak x-show="!lightboxZipLoading && !lightboxZipErrorText" class="pt-4">
            <p x-show="!lightboxZipRootDirectories.length && !lightboxZipFiles.length" class="py-8 text-sm text-slate-400">This archive is empty.</p>
              <div x-show="lightboxZipRootDirectories.length || lightboxZipFiles.length" class="space-y-3">
                <template x-for="directory in lightboxZipRootDirectories" :key="'archive-dir-' + directory.path">
                  <button type="button" class="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-left transition hover:border-cyan-500 hover:bg-slate-950" @click="navigateArchiveDirectory(directory.path)">
                    <span class="min-w-0 truncate font-semibold text-cyan-300" x-text="directory.name + '/'"></span>
                    <span class="text-xs text-slate-500">Folder</span>
                  </button>
                </template>
                <template x-for="file in lightboxZipFiles" :key="'archive-file-' + file.path">
                  <a :href="archiveEntryDownloadUrl(file)" :download="file.name" class="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 transition hover:border-cyan-500 hover:bg-slate-950">
                    <span class="min-w-0 flex-1 truncate text-slate-100" x-text="file.name"></span>
                    <span class="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400" x-text="'.' + (file.extension || 'none')"></span>
                  </a>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <button id="lightboxPrevButton" x-cloak x-show="lightboxMode !== 'zip'" @click="stepLightboxAction(-1)" :disabled="lightboxPrevDisabled" :class="{ 'opacity-40': lightboxPrevDisabled }" type="button" aria-label="Previous media" class="absolute left-3 top-1/2 z-20 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 sm:flex sm:left-6">
      <svg class="h-7 w-7" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M11.78 4.22a.75.75 0 0 1 0 1.06L7.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
      </svg>
    </button>
    <button id="lightboxNextButton" x-cloak x-show="lightboxMode !== 'zip'" @click="stepLightboxAction(1)" :disabled="lightboxNextDisabled" :class="{ 'opacity-40': lightboxNextDisabled }" type="button" aria-label="Next media" class="absolute right-3 top-1/2 z-20 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 sm:flex sm:right-6">
      <svg class="h-7 w-7" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M8.22 15.78a.75.75 0 0 1 0-1.06L12.94 10 8.22 5.28a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0Z" clip-rule="evenodd" />
      </svg>
    </button>
  </div>
  <div id="confirmDialogOverlay" @click.self="onConfirmDialogCancel()" x-cloak x-show="confirmDialogOpen" class="fixed inset-0 z-50 bg-slate-950/80 px-4 py-6">
    <div class="flex min-h-full items-center justify-center">
      <section class="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-rose-300">Confirm Delete</p>
        <h2 id="confirmDialogTitle" x-text="confirmDialogTitleText" class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">Delete selected files?</h2>
        <p id="confirmDialogMessage" x-text="confirmDialogMessageText" class="mt-3 text-sm leading-6 text-slate-400">This action cannot be undone.</p>
        <div class="mt-6 flex flex-wrap justify-end gap-3">
          <button id="confirmDialogCancelButton" @click="onConfirmDialogCancel()" type="button" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100">Cancel</button>
          <button id="confirmDialogConfirmButton" x-init="$watch('confirmDialogOpen', (value) => { if (value) { $nextTick(() => $el.focus()); } })" @click="onConfirmDialogConfirm()" x-text="confirmDialogConfirmLabel" type="button" class="rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-rose-400">Delete</button>
        </div>
      </section>
    </div>
  </div>
  <div id="uploadConflictDialogOverlay" @click.self="onUploadConflictCancel()" x-cloak x-show="uploadConflictDialogOpen" class="fixed inset-0 z-50 bg-slate-950/80 px-4 py-6">
    <div class="flex min-h-full items-center justify-center">
      <section class="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Upload Conflict</p>
        <h2 id="uploadConflictDialogTitle" x-text="uploadConflictDialogTitleText" class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">File already exists</h2>
        <p id="uploadConflictDialogMessage" x-text="uploadConflictDialogMessageText" class="mt-3 text-sm leading-6 text-slate-400">Choose whether to overwrite the existing file or upload with a different name.</p>
        <label class="mt-5 block text-sm text-slate-300">
          <span class="mb-2 block">New filename</span>
          <input id="uploadConflictDialogInput" x-model="uploadConflictFileName" x-init="$watch('uploadConflictDialogOpen', (value) => { if (value) { $nextTick(() => { $el.focus(); $el.select(); }); } })" @keydown.enter.prevent="onSubmitUploadConflictRename()" type="text" class="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500">
        </label>
        <p id="uploadConflictDialogError" x-text="uploadConflictDialogErrorText" class="mt-2 min-h-5 text-sm text-rose-300"></p>
        <div class="mt-6 flex flex-wrap justify-end gap-3">
          <button id="uploadConflictDialogCancelButton" @click="onUploadConflictCancel()" type="button" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100">Cancel</button>
          <button id="uploadConflictDialogRenameButton" @click="onSubmitUploadConflictRename()" type="button" class="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400 hover:text-cyan-100">Upload New File</button>
          <button id="uploadConflictDialogOverwriteButton" @click="onUploadConflictOverwrite()" type="button" class="rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-rose-400">Overwrite</button>
        </div>
      </section>
    </div>
  </div>
  <script>
    const AUTH_CONFIG = ${JSON.stringify({
      enabled: config.auth.enabled,
      sessionDurationMs: SESSION_DURATION_MS,
      uploadDir: config.uploadDir,
      username: config.auth.username,
    })};
    const IMAGE_EXTENSIONS = new Set(${JSON.stringify([...IMAGE_EXTENSIONS])});
    const THUMBNAIL_SUPPORTED_EXTENSIONS = new Set(${JSON.stringify([...THUMBNAIL_SUPPORTED_EXTENSIONS])});
    const VIDEO_EXTENSIONS = new Set(${JSON.stringify([...VIDEO_EXTENSIONS])});
    const SESSION_STORAGE_KEY = 'file-manager-auth';
    const REMEMBER_ME_STORAGE_KEY = 'file-manager-remembered-login';
    const LIGHTBOX_FIT_ZOOM_VALUE = 'fit-height';
    const LIGHTBOX_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300];
    function fileManagerApp() {
      return {
        authEnabled: AUTH_CONFIG.enabled,
        showLoginShell: AUTH_CONFIG.enabled,
        showAppShell: !AUTH_CONFIG.enabled,
        loginPending: false,
        loginUsername: '',
        loginPassword: '',
        rememberMe: false,
        passwordVisible: false,
        loginStatusText: '',
        sessionInfoText: AUTH_CONFIG.enabled ? '' : 'Authentication disabled',
        summaryText: '',
        selectedCountText: '0 selected',
        statusText: '',
        pageInfoText: '',
        pageInputValue: '1',
        pageInputMax: '1',
        pageSizeValue: '20',
        pageSizeOptions: [],
        pageSizeMenuOpen: false,
        viewMode: 'grid',
        breadcrumbs: [{ label: '/', path: '' }],
        availableExtensions: [],
        selectedExtensionsList: [],
        directories: [],
        files: [],
        selectedFilePaths: [],
        hasSelection: false,
        zipPending: false,
        deletePending: false,
        canGoPrev: false,
        canGoNext: false,
        uploadProgressVisible: false,
        uploadBusy: false,
        dropzoneActive: false,
        fileInputVersion: 0,
        fileInputOpenToken: 0,
        uploadProgressLabel: 'Uploading...',
        uploadProgressValue: '0%',
        uploadProgressWidth: '0%',
        confirmDialogOpen: false,
        confirmDialogTitleText: 'Delete selected files?',
        confirmDialogMessageText: 'This action cannot be undone.',
        confirmDialogConfirmLabel: 'Delete',
        uploadConflictDialogOpen: false,
        uploadConflictDialogTitleText: 'File already exists',
        uploadConflictDialogMessageText: 'Choose whether to overwrite the existing file or upload with a different name.',
        uploadConflictFileName: '',
        uploadConflictDialogErrorText: '',
        lightboxOpen: false,
        lightboxMode: '',
        lightboxPathValue: '',
        lightboxImageUrl: '',
        lightboxVideoUrl: '',
        lightboxVideoReady: false,
        lightboxVideoProgressLabel: 'Preparing video for browser playback...',
        lightboxVideoProgressValue: '0%',
        lightboxVideoProgressWidth: '0%',
        lightboxVideoErrorText: '',
        lightboxZipRootDirectories: [],
        lightboxZipFiles: [],
        lightboxZipCurrentDirectory: '',
        lightboxZipBreadcrumbs: [{ label: '/', path: '' }],
        lightboxZipLoading: false,
        lightboxZipErrorText: '',
        lightboxImageAlt: '',
        lightboxTitleValue: '',
        lightboxMetaItems: [],
        lightboxPrevDisabled: false,
        lightboxNextDisabled: false,
        lightboxZoomOptions: buildLightboxZoomOptions(100),
        lightboxZoomValue: LIGHTBOX_FIT_ZOOM_VALUE,
        lightboxZoomMenuOpen: false,
        lightboxZoomInDisabled: false,
        lightboxZoomOutDisabled: true,
        lightboxCanPan: false,
        lightboxDragging: false,
        lightboxImageStyle: {},
        videoPreparationVersion: 0,
        viewModeButtonClass(mode) {
          return this.viewMode === mode
            ? 'rounded-lg bg-cyan-500 px-3 py-1.5 font-semibold text-slate-950'
            : 'rounded-lg px-3 py-1.5 font-semibold text-slate-300 transition hover:text-cyan-300';
        },
        extensionButtonClass(extension) {
          return this.selectedExtensionsList.includes(extension)
            ? 'rounded-full border border-cyan-400 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300'
            : 'rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300';
        },
        pageSizeOptionClass(option) {
          return String(option) === this.pageSizeValue
            ? 'bg-cyan-500/15 text-cyan-200'
            : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200';
        },
        lightboxZoomOptionClass(option) {
          return option.value === this.lightboxZoomValue
            ? 'bg-cyan-500/15 text-cyan-200'
            : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200';
        },
        isExtensionSelected(extension) {
          return this.selectedExtensionsList.includes(extension);
        },
        pageSizeLabel() {
          return this.pageSizeValue;
        },
        lightboxZoomLabel() {
          return this.lightboxZoomOptions.find((option) => option.value === this.lightboxZoomValue)?.label ?? '100%';
        },
        lightboxBackdropClass() {
          if (this.lightboxMode === 'image') {
            return this.lightboxCanPan ? 'overflow-auto cursor-grab' : 'overflow-auto';
          }

          if (this.lightboxMode === 'video') {
            return 'overflow-hidden';
          }

          return 'overflow-auto';
        },
        isSelected(path) {
          return this.selectedFilePaths.includes(path);
        },
        formatBytesValue(bytes) {
          return formatBytes(bytes);
        },
        formatDateValue(value) {
          return new Date(value).toLocaleString();
        },
        formatDimensionsValue(file) {
          return formatImageDimensions(file);
        },
        downloadUrl(file) {
          return getDownloadUrl(file.path, readSession());
        },
        thumbnailUrl(file) {
          return THUMBNAIL_SUPPORTED_EXTENSIONS.has(String(file.extension || '').toLowerCase())
            || isVideoFile(file.extension)
            ? getThumbnailUrl(file.path, readSession())
            : getMediaUrl(file.path, readSession());
        },
        mediaUrl(file) {
          return getMediaUrl(file.path, readSession());
        },
        archiveEntryDownloadUrl(file) {
          return getArchiveEntryDownloadUrl(state.lightboxPath, file.path, readSession());
        },
        gridVideoUrl(file) {
          this.videoPreparationVersion;
          return getGridVideoUrl(file);
        },
        gridVideoReady(file) {
          this.videoPreparationVersion;
          return isGridVideoReady(file);
        },
        gridVideoProgressLabel(file) {
          this.videoPreparationVersion;
          return getVideoPreparationEntry(file.path, file.extension).message;
        },
        gridVideoProgressValue(file) {
          this.videoPreparationVersion;
          return getVideoPreparationEntry(file.path, file.extension).progress + '%';
        },
        gridVideoProgressWidth(file) {
          this.videoPreparationVersion;
          return getVideoPreparationEntry(file.path, file.extension).progress + '%';
        },
        gridVideoError(file) {
          this.videoPreparationVersion;
          return getVideoPreparationEntry(file.path, file.extension).error;
        },
        prepareGridVideo(file) {
          ensureVideoPreparation(file.path, file.extension);
        },
        isImage(extension) {
          return isImageFile(extension);
        },
        isVideo(extension) {
          return isVideoFile(extension);
        },
        isZip(extension) {
          return isZipFile(extension);
        },
        navigate(path) {
          navigateToDirectory(path);
        },
        toggleExtension(extension) {
          toggleExtensionSelection(extension);
        },
        toggleFileSelection(path, checked) {
          setFileSelection(path, checked);
        },
        openMedia(path, event) {
          event.preventDefault();
          event.stopPropagation();
          openLightbox(path);
        },
        openArchive(path, event) {
          event.preventDefault();
          event.stopPropagation();
          openLightbox(path);
        },
        onSharedVideoPlay(filePath, surface, event) {
          handleSharedVideoPlay(filePath, surface, event.target);
        },
        onSharedVideoPause(filePath, surface, event) {
          handleSharedVideoPause(filePath, surface, event.target);
        },
        onSharedVideoTimeUpdate(filePath, event) {
          handleSharedVideoTimeUpdate(filePath, event.target);
        },
        onSharedVideoSeeked(filePath, event) {
          handleSharedVideoSeeked(filePath, event.target);
        },
        onSharedVideoLoadedMetadata(filePath, surface, event) {
          handleSharedVideoLoadedMetadata(filePath, surface, event.target);
        },
        onSharedVideoEnded(filePath, surface, event) {
          handleSharedVideoEnded(filePath, surface, event.target);
        },
        stepLightboxAction(direction) {
          stepLightbox(direction);
        },
        navigateArchiveDirectory(path) {
          setArchivePreviewDirectory(path);
        },
        onLoginSubmit(event) {
          handleLogin(event);
        },
        onTogglePassword() {
          togglePasswordVisibility();
        },
        onRememberMeChange() {
          handleRememberMeChange();
        },
        onLogout() {
          handleLogout();
        },
        onSetViewMode(mode) {
          setViewMode(mode);
        },
        onDropzoneDragEnter(event) {
          handleDropzoneDragEnter(event);
        },
        onDropzoneDragLeave(event) {
          handleDropzoneDragLeave(event);
        },
        onDropzoneDrop(event) {
          handleDropzoneDrop(event);
        },
        onOpenFileInput() {
          if (!getApp().uploadBusy) {
            getApp().fileInputOpenToken += 1;
          }
        },
        onCreateSelectionZip() {
          createSelectionZip();
        },
        onDeleteSelectedFiles() {
          deleteSelectedFiles();
        },
        onFileInputChange(event) {
          uploadFiles(event.target.files);
        },
        onChangePageBy(delta) {
          changePageBy(delta);
        },
        onSubmitCurrentPageInput() {
          submitCurrentPageInput();
        },
        onPageSizeChange() {
          handlePageSizeChange();
        },
        onTogglePageSizeMenu() {
          getApp().pageSizeMenuOpen = !getApp().pageSizeMenuOpen;
        },
        onClosePageSizeMenu() {
          getApp().pageSizeMenuOpen = false;
        },
        onSelectPageSize(option) {
          selectPageSizeOption(option);
        },
        onGlobalKeydown(event) {
          handleGlobalKeydown(event);
        },
        onViewportResize() {
          scheduleLightboxImageLayout();
          scheduleLightboxVideoLayout();
        },
        onCloseLightbox() {
          closeLightbox();
        },
        onLightboxBackdropClick(event) {
          handleLightboxBackdropClick(event);
        },
        onLightboxImageLoad(event) {
          syncLightboxImageMetrics(event.target);
        },
        onLightboxZoomChange() {
          setLightboxZoom(getApp().lightboxZoomValue);
        },
        onToggleLightboxZoomMenu() {
          getApp().lightboxZoomMenuOpen = !getApp().lightboxZoomMenuOpen;
        },
        onCloseLightboxZoomMenu() {
          getApp().lightboxZoomMenuOpen = false;
        },
        onSelectLightboxZoom(value) {
          selectLightboxZoomOption(value);
        },
        onLightboxZoomIn() {
          nudgeLightboxZoom(1);
        },
        onLightboxZoomOut() {
          nudgeLightboxZoom(-1);
        },
        onLightboxPointerDown(event) {
          startLightboxPan(event);
        },
        onLightboxPointerMove(event) {
          moveLightboxPan(event);
        },
        onLightboxPointerUp(event) {
          endLightboxPan(event);
        },
        onConfirmDialogCancel() {
          closeConfirmDialog(false);
        },
        onConfirmDialogConfirm() {
          closeConfirmDialog(true);
        },
        onUploadConflictCancel() {
          closeUploadConflictDialog({ action: 'cancel' });
        },
        onSubmitUploadConflictRename() {
          submitUploadConflictRename();
        },
        onUploadConflictOverwrite() {
          closeUploadConflictDialog({ action: 'overwrite' });
        },
        init() {
          window.__fileManagerApp = this;
          initializeUiState();
          const initialLocationState = readInitialLocationState();
          console.log('[DEBUG init] initialLocationState:', initialLocationState, 'url:', window.location.href);
          state.currentDir = initialLocationState.directory;
          state.requestedExtensions = new Set(initialLocationState.selectedExtensions);
          state.selectedExtensions = new Set(initialLocationState.selectedExtensions);
          console.log('[DEBUG init] requestedExtensions after set:', [...state.requestedExtensions]);
          state.initialLightboxPath = initialLocationState.filePath;
          state.initialLightboxZoomValue = initialLocationState.zoomValue;
          state.pendingInitialLightboxRestore = Boolean(initialLocationState.filePath);

          const existingSession = readSession();

          if (!AUTH_CONFIG.enabled || existingSession) {
            this.loginUsername = existingSession?.username ?? AUTH_CONFIG.username;
            showApp();
            initializeApp().catch((error) => {
              this.statusText = error.message;
            });
            return;
          }

          this.loginUsername = AUTH_CONFIG.username;
          showLogin();
        },
      };
    }

    function getApp() {
      return window.__fileManagerApp;
    }

    function setBodyScrollLocked(locked) {
      document.body.classList.toggle('overflow-hidden', locked);
    }

    function normalizeClientRelativeDirectory(relativeDir) {
      const parts = String(relativeDir || '').split('/');
      const normalizedParts = [];

      for (const part of parts) {
        if (!part || part === '.') {
          continue;
        }

        if (part === '..') {
          throw new Error('Invalid directory path');
        }

        normalizedParts.push(part);
      }

      return normalizedParts.join('/');
    }

    function normalizeClientRelativePath(relativePath) {
      return normalizeClientRelativeDirectory(relativePath);
    }

    function getClientParentDirectory(relativePath) {
      const normalizedPath = normalizeClientRelativePath(relativePath);
      const parts = normalizedPath ? normalizedPath.split('/') : [];
      parts.pop();
      return parts.join('/');
    }

    function normalizeLightboxZoomValue(value) {
      const rawValue = String(value ?? '').trim();

      if (!rawValue) {
        return null;
      }

      if (rawValue === LIGHTBOX_FIT_ZOOM_VALUE) {
        return LIGHTBOX_FIT_ZOOM_VALUE;
      }

      const zoomPercent = Number(rawValue);
      return LIGHTBOX_ZOOM_LEVELS.includes(zoomPercent) ? String(zoomPercent) : null;
    }

    function normalizeExtensionValue(value) {
      const normalizedValue = String(value ?? '').trim().toLowerCase().replace(/^\.+/, '');
      return normalizedValue && !normalizedValue.includes('/') ? normalizedValue : '';
    }

    function parseSelectedExtensionsParam(values) {
      const rawValues = Array.isArray(values) ? values : [values];
      const extensions = new Set();

      for (const rawValue of rawValues) {
        const normalizedValue = String(rawValue ?? '').trim();

        if (!normalizedValue) {
          continue;
        }

        for (const item of normalizedValue.split(',')) {
          const extension = normalizeExtensionValue(item);

          if (extension) {
            extensions.add(extension);
          }
        }
      }

      return extensions;
    }

    function readInitialLocationState() {
      const url = new URL(window.location.href);
      const relativePath = url.searchParams.get('p') ?? '';
      const filePath = url.searchParams.get('f') ?? '';
      const zoomValue = normalizeLightboxZoomValue(url.searchParams.get('z'));
      const selectedExtensions = parseSelectedExtensionsParam(url.searchParams.getAll('ext'));
      let directory = '';
      let normalizedFilePath = '';

      try {
        directory = normalizeClientRelativeDirectory(relativePath);
      } catch {
        directory = '';
      }

      try {
        normalizedFilePath = normalizeClientRelativePath(filePath);
      } catch {
        normalizedFilePath = '';
      }

      if (normalizedFilePath) {
        directory = getClientParentDirectory(normalizedFilePath);
      }

      return {
        directory,
        filePath: normalizedFilePath,
        zoomValue,
        selectedExtensions,
      };
    }

    function syncLocationState() {
      console.log('[DEBUG syncLocationState] requestedExtensions:', [...state.requestedExtensions], 'currentDir:', state.currentDir, 'url:', window.location.href);
      const url = new URL(window.location.href);
      const relativePath = state.currentDir;

      if (relativePath) {
        url.searchParams.set('p', relativePath);
      } else {
        url.searchParams.delete('p');
      }

      url.searchParams.delete('ext');

      for (const extension of [...state.requestedExtensions].sort()) {
        url.searchParams.append('ext', extension);
      }

      if (getApp().lightboxOpen && state.lightboxPath) {
        url.searchParams.set('f', state.lightboxPath);

        if (getApp().lightboxMode === 'image') {
          url.searchParams.set('z', getApp().lightboxZoomValue);
        } else {
          url.searchParams.delete('z');
        }
      } else {
        url.searchParams.delete('f');
        url.searchParams.delete('z');
      }

      console.log('[DEBUG syncLocationState] result URL:', url.pathname + (url.search ? url.search : ''));
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }

    const state = {
      page: 1,
      pageSize: 20,
      totalPages: 1,
      currentDir: '',
      viewMode: 'grid',
      selectedFiles: new Set(),
      requestedExtensions: new Set(),
      selectedExtensions: new Set(),
      visibleMediaFiles: [],
      videoPreparationByPath: new Map(),
      sharedVideoPlaybackByPath: new Map(),
      sharedVideoSyncDepth: 0,
      lightboxIndex: -1,
      lightboxPath: '',
      pendingLightboxDirection: 0,
      lightboxLoadToken: 0,
      isUploading: false,
      lightboxImageNaturalWidth: 0,
      lightboxImageNaturalHeight: 0,
      lightboxVideoNaturalWidth: 0,
      lightboxVideoNaturalHeight: 0,
      lightboxPanPointerId: null,
      lightboxPanStartX: 0,
      lightboxPanStartY: 0,
      lightboxPanScrollLeft: 0,
      lightboxPanScrollTop: 0,
      lightboxPanMoved: false,
      initialLightboxPath: '',
      initialLightboxZoomValue: null,
      pendingInitialLightboxRestore: false,
      confirmDialogResolver: null,
      uploadConflictDialogResolver: null,
      archivePreviewFiles: [],
      archivePreviewDirectories: [],
      archivePreviewCurrentDirectory: '',
    };

    function initializeUiState() {
      if (!AUTH_CONFIG.enabled) {
        getApp().sessionInfoText = 'Authentication disabled';
      }
    }

    function getSharedVideoPlaybackEntry(filePath) {
      const normalizedPath = String(filePath || '');

      if (!normalizedPath) {
        return {
          currentTime: 0,
          shouldResume: false,
          preferredSurface: 'grid',
        };
      }

      const existing = state.sharedVideoPlaybackByPath.get(normalizedPath);

      if (existing) {
        return existing;
      }

      const entry = {
        currentTime: 0,
        shouldResume: false,
        preferredSurface: 'grid',
      };

      state.sharedVideoPlaybackByPath.set(normalizedPath, entry);
      return entry;
    }

    function runWithSharedVideoSyncSuppressed(callback) {
      state.sharedVideoSyncDepth += 1;

      try {
        return callback();
      } finally {
        state.sharedVideoSyncDepth = Math.max(0, state.sharedVideoSyncDepth - 1);
      }
    }

    function shouldIgnoreSharedVideoEvent(filePath, element) {
      return state.sharedVideoSyncDepth > 0 || !filePath || !(element instanceof HTMLVideoElement);
    }

    function getSharedVideoElements() {
      return [...document.querySelectorAll('video[data-shared-video]')]
        .filter((element) => element instanceof HTMLVideoElement && element.isConnected);
    }

    function getSharedVideoElementPath(element) {
      return String(element?.dataset?.videoPath || '');
    }

    function getSharedVideoElementSurface(element) {
      return String(element?.dataset?.sharedVideo || '');
    }

    function isSharedVideoPlaybackActive(element) {
      return element instanceof HTMLVideoElement && !element.paused && !element.ended;
    }

    function getSharedVideoElementsByPath(filePath) {
      return getSharedVideoElements().filter((element) => getSharedVideoElementPath(element) === filePath);
    }

    function getPreferredSharedVideoElement(filePath) {
      const matchingElements = getSharedVideoElementsByPath(filePath);
      const activeElement = matchingElements.find((element) => isSharedVideoPlaybackActive(element));

      if (activeElement) {
        return activeElement;
      }

      return matchingElements.find((element) => getSharedVideoElementSurface(element) === 'lightbox')
        ?? matchingElements[0]
        ?? null;
    }

    function updateSharedVideoPlayback(filePath, nextValues) {
      if (!filePath) {
        return getSharedVideoPlaybackEntry(filePath);
      }

      const entry = getSharedVideoPlaybackEntry(filePath);
      Object.assign(entry, nextValues);
      return entry;
    }

    function storeSharedVideoPlayback(filePath, element, nextValues = {}) {
      if (!filePath) {
        return getSharedVideoPlaybackEntry(filePath);
      }

      const currentTime = element instanceof HTMLVideoElement && Number.isFinite(element.currentTime)
        ? Math.max(0, element.currentTime)
        : undefined;

      return updateSharedVideoPlayback(filePath, {
        ...(currentTime === undefined ? {} : { currentTime }),
        ...nextValues,
      });
    }

    function pauseSharedVideoElement(element) {
      if (!(element instanceof HTMLVideoElement) || element.paused) {
        return;
      }

      runWithSharedVideoSyncSuppressed(() => {
        element.pause();
      });
    }

    function pauseOtherSharedVideos(activeFilePath, activeElement = null) {
      for (const element of getSharedVideoElements()) {
        if (element === activeElement) {
          continue;
        }

        const filePath = getSharedVideoElementPath(element);

        if (!filePath) {
          continue;
        }

        storeSharedVideoPlayback(
          filePath,
          element,
          filePath === activeFilePath ? {} : { shouldResume: false },
        );
        pauseSharedVideoElement(element);
      }
    }

    function applySharedVideoPlaybackToElement(filePath, surface, element) {
      if (!filePath || !(element instanceof HTMLVideoElement)) {
        return;
      }

      const entry = getSharedVideoPlaybackEntry(filePath);

      runWithSharedVideoSyncSuppressed(() => {
        if (element.readyState >= 1 && Number.isFinite(entry.currentTime) && Math.abs(element.currentTime - entry.currentTime) > 0.2) {
          element.currentTime = entry.currentTime;
        }

        if (entry.shouldResume && entry.preferredSurface === surface) {
          pauseOtherSharedVideos(filePath, element);
          element.play().catch(() => {});
          return;
        }

        if (!element.paused) {
          element.pause();
        }
      });
    }

    function handoffSharedVideoToSurface(filePath, surface, defaultShouldResume = false) {
      if (!filePath) {
        return;
      }

      const entry = getSharedVideoPlaybackEntry(filePath);
      const sourceElement = getPreferredSharedVideoElement(filePath);
      const shouldResume = sourceElement
        ? isSharedVideoPlaybackActive(sourceElement)
        : (entry.shouldResume || defaultShouldResume);

      storeSharedVideoPlayback(filePath, sourceElement, {
        preferredSurface: surface,
        shouldResume,
      });
      pauseOtherSharedVideos(filePath, null);
    }

    function syncSharedVideoSurface(filePath, surface) {
      if (!filePath) {
        return;
      }

      const targetElement = getSharedVideoElementsByPath(filePath)
        .find((element) => getSharedVideoElementSurface(element) === surface);

      if (!targetElement) {
        return;
      }

      applySharedVideoPlaybackToElement(filePath, surface, targetElement);
    }

    function handleSharedVideoPlay(filePath, surface, element) {
      if (shouldIgnoreSharedVideoEvent(filePath, element)) {
        return;
      }

      storeSharedVideoPlayback(filePath, element, {
        shouldResume: true,
        preferredSurface: surface,
      });
      pauseOtherSharedVideos(filePath, element);
    }

    function handleSharedVideoPause(filePath, surface, element) {
      if (shouldIgnoreSharedVideoEvent(filePath, element)) {
        return;
      }

      storeSharedVideoPlayback(filePath, element, {
        shouldResume: false,
        preferredSurface: surface,
      });
    }

    function handleSharedVideoTimeUpdate(filePath, element) {
      if (shouldIgnoreSharedVideoEvent(filePath, element)) {
        return;
      }

      storeSharedVideoPlayback(filePath, element, {
        shouldResume: isSharedVideoPlaybackActive(element),
      });
    }

    function handleSharedVideoSeeked(filePath, element) {
      if (shouldIgnoreSharedVideoEvent(filePath, element)) {
        return;
      }

      storeSharedVideoPlayback(filePath, element);
    }

    function handleSharedVideoLoadedMetadata(filePath, surface, element) {
      if (!filePath || !(element instanceof HTMLVideoElement)) {
        return;
      }

      if (surface === 'lightbox') {
        syncLightboxVideoMetrics(element);
      }

      applySharedVideoPlaybackToElement(filePath, surface, element);
    }

    function handleSharedVideoEnded(filePath, surface, element) {
      if (shouldIgnoreSharedVideoEvent(filePath, element)) {
        return;
      }

      storeSharedVideoPlayback(filePath, element, {
        shouldResume: false,
        preferredSurface: surface,
      });
    }

    function handleRememberMeChange() {
      if (!getApp().rememberMe) {
        clearRememberedLogin();
      }
    }

    function handlePageSizeChange() {
      state.pageSize = getApp().pageSizeValue === 'All' ? 'All' : Number(getApp().pageSizeValue);
      state.page = 1;
      getApp().pageSizeMenuOpen = false;
      loadFiles();
    }

    function selectPageSizeOption(option) {
      getApp().pageSizeValue = String(option);
      handlePageSizeChange();
    }

    function submitCurrentPageInput() {
      const targetPage = Math.min(state.totalPages, Math.max(1, Number(getApp().pageInputValue || '1')));
      state.page = targetPage;
      loadFiles();
    }

    function isEditableEventTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }

      if (target.closest('[contenteditable="true"]')) {
        return true;
      }

      const field = target.closest('input, textarea, select');
      return Boolean(field && !(field instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(field.type)));
    }

    function handleGlobalKeydown(event) {
      if (getApp().pageSizeMenuOpen && event.key === 'Escape') {
        getApp().pageSizeMenuOpen = false;
        return;
      }

      if (getApp().lightboxZoomMenuOpen && event.key === 'Escape') {
        getApp().lightboxZoomMenuOpen = false;
        return;
      }

      if (getApp().uploadConflictDialogOpen) {
        if (event.key === 'Escape') {
          closeUploadConflictDialog({ action: 'cancel' });
        }
        return;
      }

      if (getApp().confirmDialogOpen) {
        if (event.key === 'Escape') {
          closeConfirmDialog(false);
        }
        return;
      }

      if (!getApp().lightboxOpen) {
        if (!getApp().showAppShell || getApp().pageSizeMenuOpen || isEditableEventTarget(event.target)) {
          return;
        }

        if (event.key === 'ArrowLeft' && getApp().canGoPrev) {
          event.preventDefault();
          changePageBy(-1);
          return;
        }

        if (event.key === 'ArrowRight' && getApp().canGoNext) {
          event.preventDefault();
          changePageBy(1);
        }

        return;
      }

      if (event.key === 'Escape') {
        closeLightbox();
        return;
      }

      if (event.key === 'ArrowLeft') {
        stepLightbox(-1);
        return;
      }

      if (event.key === 'ArrowRight') {
        stepLightbox(1);
        return;
      }

      if (event.key === 'ArrowUp' && getApp().lightboxMode === 'image') {
        event.preventDefault();
        nudgeLightboxZoom(1);
        return;
      }

      if (event.key === 'ArrowDown' && getApp().lightboxMode === 'image') {
        event.preventDefault();
        nudgeLightboxZoom(-1);
      }
    }

    function changePageBy(delta) {
      const nextPage = state.page + delta;

      if (nextPage < 1 || nextPage > state.totalPages) {
        return;
      }

      state.page = nextPage;
      loadFiles();
    }

    function handleDropzoneDragEnter(event) {
      event.preventDefault();
      getApp().dropzoneActive = true;
    }

    function handleDropzoneDragLeave(event) {
      event.preventDefault();

      if (event.currentTarget === event.target) {
        getApp().dropzoneActive = false;
      }
    }

    function handleDropzoneDrop(event) {
      getApp().dropzoneActive = false;
      uploadFiles(event.dataTransfer.files);
    }

    function togglePasswordVisibility() {
      const nextVisible = !getApp().passwordVisible;
      getApp().passwordVisible = nextVisible;
    }

    function setViewMode(mode) {
      state.viewMode = mode;
      getApp().viewMode = mode;
      loadFiles();
    }

    function readSession() {
      if (!AUTH_CONFIG.enabled) {
        return {
          username: AUTH_CONFIG.username || 'Guest',
          token: '',
          expiresAt: Date.now() + AUTH_CONFIG.sessionDurationMs,
        };
      }

      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);

      if (!raw) {
        return null;
      }

      try {
        const session = JSON.parse(raw);

        if (typeof session.expiresAt !== 'number' || typeof session.token !== 'string' || !session.token || Date.now() >= session.expiresAt) {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
          return null;
        }

        return session;
      } catch {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
    }

    function readRememberedLogin() {
      const raw = localStorage.getItem(REMEMBER_ME_STORAGE_KEY);

      if (!raw) {
        return null;
      }

      try {
        const rememberedLogin = JSON.parse(raw);

        if (typeof rememberedLogin.username !== 'string' || typeof rememberedLogin.password !== 'string') {
          localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
          return null;
        }

        return rememberedLogin;
      } catch {
        localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
        return null;
      }
    }

    function writeRememberedLogin() {
      localStorage.setItem(REMEMBER_ME_STORAGE_KEY, JSON.stringify({
        username: getApp().loginUsername,
        password: getApp().loginPassword,
      }));
    }

    function clearRememberedLogin() {
      localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
    }

    function applyRememberedLogin() {
      const rememberedLogin = readRememberedLogin();

      if (!rememberedLogin) {
        getApp().rememberMe = false;
        return;
      }

      getApp().loginUsername = rememberedLogin.username;
      getApp().loginPassword = rememberedLogin.password;
      getApp().rememberMe = true;
    }

    function writeSession(username, token) {
      const session = {
        username,
        token,
        expiresAt: Date.now() + AUTH_CONFIG.sessionDurationMs,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      return session;
    }

    function getAuthHeaders() {
      const session = readSession();

      if (!session) {
        return {};
      }

      return { 'x-session-token': session.token };
    }

    function updateSessionInfo() {
      if (!AUTH_CONFIG.enabled) {
        getApp().sessionInfoText = 'Authentication disabled';
        return;
      }

      const session = readSession();

      if (!session) {
        getApp().sessionInfoText = 'Session expired';
        return;
      }

      const remainingMinutes = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 60000));
      getApp().sessionInfoText = session.username + ' • expires in ' + remainingMinutes + ' min';
    }

    function showLogin() {
      if (!AUTH_CONFIG.enabled) {
        showApp();
        return;
      }

      getApp().showLoginShell = true;
      getApp().showAppShell = false;
      updateSessionInfo();
      getApp().passwordVisible = false;
      applyRememberedLogin();
      if (!getApp().rememberMe) {
        getApp().loginPassword = '';
      }
      window.clearTimeout(window.__fileManagerSessionTimer);
    }

    function showApp() {
      getApp().showLoginShell = false;
      getApp().showAppShell = true;
      scheduleSessionExpiry();
      updateSessionInfo();
    }

    function scheduleSessionExpiry() {
      if (!AUTH_CONFIG.enabled) {
        window.clearTimeout(window.__fileManagerSessionTimer);
        return;
      }

      const session = readSession();
      window.clearTimeout(window.__fileManagerSessionTimer);

      if (!session) {
        return;
      }

      const remainingMs = Math.max(0, session.expiresAt - Date.now());
      window.__fileManagerSessionTimer = window.setTimeout(() => {
        forceLogout('Session expired. Please log in again.');
      }, remainingMs);
    }

    async function handleLogin(event) {
      event.preventDefault();
      getApp().loginPending = true;
      getApp().loginStatusText = 'Signing in...';

      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: getApp().loginUsername,
          password: getApp().loginPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      getApp().loginPending = false;

      if (!response.ok) {
        getApp().loginStatusText = data.error ?? 'Login failed.';
        return;
      }

      if (getApp().rememberMe) {
        writeRememberedLogin();
      } else {
        clearRememberedLogin();
      }

      writeSession(getApp().loginUsername, data.token);
      getApp().loginStatusText = '';
      showApp();
      await initializeApp();
    }

    async function handleLogout() {
      if (!AUTH_CONFIG.enabled) {
        forceLogout();
        return;
      }

      try {
        const response = await fetch('/api/logout', {
          method: 'POST',
          headers: getAuthHeaders(),
        });

      if (response.status === 401) {
        console.log('[DEBUG loadFiles] 401 response');
        forceLogout('Session expired. Please log in again.');
        return;
      }
      } catch {
        // Clear local session state even if the logout request fails.
      }

      forceLogout();
    }

    function forceLogout(message = 'Session ended. Please log in again.') {
      if (!AUTH_CONFIG.enabled) {
        getApp().statusText = message;
        showApp();
        return;
      }

      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      state.selectedFiles.clear();
      getApp().loginStatusText = message;
      showLogin();
    }

    async function initializeApp() {
      getApp().viewMode = state.viewMode;
      getApp().selectedExtensionsList = [...state.requestedExtensions].sort();
      updateSelectedCount();
      console.log('[DEBUG initializeApp] before loadExtensions, requestedExtensions:', [...state.requestedExtensions]);
      await loadExtensions();
      console.log('[DEBUG initializeApp] after loadExtensions, before loadFiles, requestedExtensions:', [...state.requestedExtensions]);
      await loadFiles();
      console.log('[DEBUG initializeApp] after loadFiles, requestedExtensions:', [...state.requestedExtensions]);
    }

    async function loadExtensions() {
      const query = new URLSearchParams({ dir: state.currentDir });
      const response = await fetch('/api/extensions?' + query.toString(), {
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        forceLogout('Session expired. Please log in again.');
        return;
      }
      const data = await response.json();
      getApp().availableExtensions = data.extensions;
      getApp().selectedExtensionsList = [...state.requestedExtensions].sort();
    }

    async function loadFiles() {
      console.log('[DEBUG loadFiles] requestedExtensions:', [...state.requestedExtensions], 'url:', window.location.href);
      if (!readSession()) {
        console.log('[DEBUG loadFiles] no session, aborting');
        forceLogout('Session expired. Please log in again.');
        return;
      }

      updateSessionInfo();
      getApp().statusText = 'Loading files...';
      const query = new URLSearchParams({
        dir: state.currentDir,
        page: String(state.page),
        pageSize: String(state.pageSize),
      });

      for (const extension of [...state.requestedExtensions].sort()) {
        query.append('ext', extension);
      }

      console.log('[DEBUG loadFiles] API query:', query.toString());
      const response = await fetch('/api/files?' + query.toString(), {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        console.log('[DEBUG loadFiles] 401 from /api/files');
        forceLogout('Session expired. Please log in again.');
        return;
      }

      const data = await response.json();

      getApp().pageSizeOptions = data.pageSizeOptions;

      state.page = data.page;
      state.totalPages = data.totalPages;
      state.currentDir = data.directory;
      state.visibleMediaFiles = data.files.filter((file) => isImageFile(file.extension));
      getApp().directories = data.directories;
      getApp().files = data.files;
      primeVisibleVideoPreparations(data.files);
      getApp().pageInfoText = String(data.totalPages);
      getApp().pageInputValue = String(data.page);
      getApp().pageInputMax = String(data.totalPages);
      getApp().pageSizeValue = String(data.pageSize);
      getApp().pageSizeMenuOpen = false;
      getApp().canGoPrev = data.page > 1;
      getApp().canGoNext = data.page < data.totalPages;
      syncBreadcrumbState();
      syncLocationState();

      if (!state.visibleMediaFiles.length && getApp().lightboxOpen && getApp().lightboxMode !== 'zip') {
        closeLightbox();
      } else if (state.pendingLightboxDirection) {
        state.lightboxIndex = state.pendingLightboxDirection > 0 ? 0 : state.visibleMediaFiles.length - 1;
        state.lightboxPath = state.visibleMediaFiles[state.lightboxIndex]?.path ?? '';
        state.pendingLightboxDirection = 0;
        syncLightboxState();
      } else if (state.lightboxPath && getApp().lightboxMode !== 'zip') {
        const nextIndex = state.visibleMediaFiles.findIndex((file) => file.path === state.lightboxPath);

        if (nextIndex === -1) {
          closeLightbox();
        } else {
          state.lightboxIndex = nextIndex;
          syncLightboxState();
        }
      }

      restoreInitialLightboxFromLocation();

      getApp().summaryText = data.directories.length + ' folders, ' + data.total + ' files';
      updateSelectedCount();

      getApp().statusText = (data.directories.length || data.files.length) ? '' : 'No items found.';
    }

    async function uploadFiles(files) {
      if (!readSession()) {
        forceLogout('Session expired. Please log in again.');
        return;
      }

      if (state.isUploading) {
        return;
      }

      if (!files || !files.length) {
        return;
      }

      const uploadStartTime = performance.now();
      const uploadQueue = [];
      let uploadedBytes = 0;
      const uploadedNames = [];

      for (const file of [...files]) {
        const uploadPlan = await prepareUploadFile(file);

        if (!uploadPlan) {
          continue;
        }

        uploadQueue.push(uploadPlan);
      }

      if (!uploadQueue.length) {
        getApp().statusText = 'Upload cancelled.';
        getApp().fileInputVersion += 1;
        return;
      }

      const totalUploadBytes = uploadQueue.reduce((sum, item) => sum + item.file.size, 0);

      state.isUploading = true;
      getApp().uploadBusy = true;
      renderUploadProgress(0, totalUploadBytes, uploadQueue.length);
      getApp().statusText = 'Uploading ' + uploadQueue.length + ' file(s)...';

      try {
        for (const [index, item] of uploadQueue.entries()) {
          const formData = new FormData();
          formData.append('files', item.file, item.fileName);
          const { response, data } = await sendUploadRequest(
            formData,
            uploadQueue.length,
            uploadedBytes,
            totalUploadBytes,
            item.overwrite,
            index,
          );

          if (response.status === 401) {
            hideUploadProgress();
            forceLogout('Session expired. Please log in again.');
            return;
          }

          if (!response.ok) {
            getApp().statusText = data.error ?? 'Upload failed.';
            return;
          }

          uploadedBytes += item.file.size;
          uploadedNames.push(...data.uploaded);
        }

        getApp().fileInputVersion += 1;
        await loadExtensions();
        await loadFiles();
        const elapsedMs = Math.max(1, performance.now() - uploadStartTime);
        const bytesPerSecond = (uploadedBytes / elapsedMs) * 1000;
        getApp().statusText = 'Uploaded: ' + uploadedNames.join(', ')
          + ' (' + formatBytes(uploadedBytes)
          + ' in ' + formatDuration(elapsedMs)
          + ', ' + formatBytes(bytesPerSecond) + '/s)';
      } catch (error) {
        getApp().statusText = error.message || 'Upload failed.';
      } finally {
        state.isUploading = false;
        getApp().uploadBusy = false;
        hideUploadProgress();
      }
    }

    async function prepareUploadFile(file) {
      const uploadTarget = await getUploadTarget(file.name);

      if (!uploadTarget.exists) {
        return {
          file,
          fileName: file.name,
          overwrite: false,
        };
      }

      const decision = await openUploadConflictDialog(file.name, uploadTarget.suggestedName || file.name);

      if (decision.action === 'overwrite') {
        return {
          file,
          fileName: file.name,
          overwrite: true,
        };
      }

      if (decision.action === 'cancel') {
        return null;
      }

      const trimmedName = decision.fileName.trim();

      if (!trimmedName) {
        throw new Error('Upload cancelled: filename is required.');
      }

      return prepareUploadFile(new File([file], trimmedName, {
        type: file.type,
        lastModified: file.lastModified,
      }));
    }

    async function getUploadTarget(fileName) {
      const query = new URLSearchParams({
        dir: state.currentDir,
        name: fileName,
      });
      const response = await fetch('/api/upload-target?' + query.toString(), {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        forceLogout('Session expired. Please log in again.');
        throw new Error('Session expired. Please log in again.');
      }

      return response.json();
    }

    function sendUploadRequest(formData, fileCount, uploadedBytes, totalUploadBytes, overwrite, fileIndex) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const query = new URLSearchParams({ dir: state.currentDir });

        if (overwrite) {
          query.set('overwrite', '1');
        }

        xhr.open('POST', '/api/upload?' + query.toString());

        for (const [name, value] of Object.entries(getAuthHeaders())) {
          xhr.setRequestHeader(name, value);
        }

        xhr.upload.addEventListener('progress', (event) => {
          const currentFileTotal = event.lengthComputable ? event.total : 0;
          renderUploadProgress(uploadedBytes + event.loaded, totalUploadBytes || currentFileTotal, fileCount, fileIndex + 1);
        });

        xhr.addEventListener('load', () => {
          const data = JSON.parse(xhr.responseText || '{}');
          resolve({
            response: {
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
            },
            data,
          });
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed.')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));
        xhr.send(formData);
      });
    }

    function renderUploadProgress(loadedBytes, totalBytes, fileCount) {
      const percent = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;
      getApp().uploadProgressVisible = true;
      getApp().uploadProgressWidth = percent + '%';
      getApp().uploadProgressValue = percent + '%';
      getApp().uploadProgressLabel = totalBytes > 0
        ? 'Uploading ' + fileCount + ' file(s): ' + formatBytes(loadedBytes) + ' / ' + formatBytes(totalBytes)
        : 'Uploading ' + fileCount + ' file(s)...';
    }

    function hideUploadProgress() {
      getApp().uploadProgressVisible = false;
      getApp().uploadProgressWidth = '0%';
      getApp().uploadProgressValue = '0%';
      getApp().uploadProgressLabel = 'Uploading...';
    }

    async function createSelectionZip() {
      if (!readSession()) {
        forceLogout('Session expired. Please log in again.');
        return;
      }

      if (!state.selectedFiles.size) {
        getApp().statusText = 'Select at least one file first.';
        return;
      }

      getApp().zipPending = true;
      getApp().statusText = 'Creating zip from selected items...';

      const query = new URLSearchParams({ dir: state.currentDir });

      const response = await fetch('/api/zip-selection?' + query.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ items: [...state.selectedFiles] }),
      });

      getApp().zipPending = false;

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        getApp().statusText = data.error ?? 'Failed to create zip file.';
        return;
      }

      const blob = await response.blob();
      const fileName = getDownloadFileName(response.headers.get('content-disposition'));
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = downloadUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(downloadUrl);

      state.selectedFiles.clear();
      updateSelectedCount();
      getApp().statusText = 'Downloaded zip: ' + fileName;
    }

    async function deleteSelectedFiles() {
      if (!readSession()) {
        forceLogout('Session expired. Please log in again.');
        return;
      }

      if (!state.selectedFiles.size) {
        getApp().statusText = 'Select at least one file first.';
        return;
      }

      const confirmed = await openConfirmDialog({
        title: 'Delete selected items?',
        message: 'Delete ' + state.selectedFiles.size + ' selected item(s)? Directories can only be deleted under upload. This action cannot be undone.',
        confirmLabel: 'Delete',
      });

      if (!confirmed) {
        return;
      }

      getApp().deletePending = true;
      getApp().statusText = 'Deleting selected files...';

      const query = new URLSearchParams({ dir: state.currentDir });

      const response = await fetch('/api/delete-selection?' + query.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ items: [...state.selectedFiles] }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        getApp().deletePending = false;
        getApp().statusText = data.error ?? 'Failed to delete selected files.';
        return;
      }

      state.selectedFiles.clear();
      updateSelectedCount();
      getApp().deletePending = false;
      getApp().statusText = 'Deleted ' + data.deleted.length + ' item(s).';
      await loadExtensions();
      await loadFiles();
    }

    function formatBytes(bytes) {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let index = 0;

      while (value >= 1000 && index < units.length - 1) {
        value /= 1000;
        index += 1;
      }

      return (value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[index];
    }

    function formatImageDimensions(file) {
      const width = Number(file?.width);
      const height = Number(file?.height);

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return '';
      }

      return width + ' x ' + height;
    }

    function formatDuration(durationMs) {
      if (durationMs < 1000) {
        return Math.round(durationMs) + ' ms';
      }

      return (durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1) + ' s';
    }

    function escapeHtml(value) {
      return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function syncBreadcrumbState() {
      const segments = state.currentDir ? state.currentDir.split('/') : [];
      const items = [{ label: '/', path: '' }];
      let currentPath = '';

      for (const segment of segments) {
        currentPath = currentPath ? currentPath + '/' + segment : segment;
        items.push({ label: segment, path: currentPath });
      }

      getApp().breadcrumbs = items;
    }

    function toggleExtensionSelection(extension) {
      if (state.requestedExtensions.has(extension)) {
        state.requestedExtensions.delete(extension);
        state.selectedExtensions.delete(extension);
      } else {
        state.requestedExtensions.add(extension);
        state.selectedExtensions.add(extension);
      }

      getApp().selectedExtensionsList = [...state.requestedExtensions].sort();
      state.page = 1;
      loadExtensions().then(() => loadFiles());
    }

    function isImageFile(extension) {
      return IMAGE_EXTENSIONS.has(String(extension || '').toLowerCase());
    }

    function isVideoFile(extension) {
      return VIDEO_EXTENSIONS.has(String(extension || '').toLowerCase());
    }

    function isZipFile(extension) {
      return String(extension || '').toLowerCase() === 'zip';
    }

    function setFileSelection(filePath, checked) {
      if (!filePath) {
        return;
      }

      if (checked) {
        state.selectedFiles.add(filePath);
      } else {
        state.selectedFiles.delete(filePath);
      }

      updateSelectedCount();
    }

    function openLightbox(filePath, options = {}) {
      const currentFile = getApp().files.find((file) => file.path === filePath) ?? null;

      if (!currentFile) {
        return;
      }

      if (isZipFile(currentFile.extension)) {
        openArchiveLightbox(currentFile);
        return;
      }

      if (isVideoFile(currentFile.extension)) {
        return;
      }

      const nextIndex = state.visibleMediaFiles.findIndex((file) => file.path === filePath);

      if (nextIndex === -1) {
        return;
      }

      const initialZoomValue = normalizeLightboxZoomValue(options.zoomValue);
      state.lightboxIndex = nextIndex;
      state.lightboxPath = filePath;
      getApp().lightboxOpen = true;
      setBodyScrollLocked(true);

      if (initialZoomValue) {
        getApp().lightboxZoomValue = initialZoomValue;
        getApp().lightboxZoomMenuOpen = false;
        updateLightboxZoomOptionLabels();
        updateLightboxZoomControls();
      } else {
        resetLightboxZoom(false);
      }

      syncLightboxState();
      scheduleLightboxImageLayout();
    }

    function closeLightbox() {
      const closingLightboxPath = state.lightboxPath;
      const shouldRestoreGridVideo = getApp().lightboxMode === 'video' && closingLightboxPath;

      if (shouldRestoreGridVideo) {
        storeSharedVideoPlayback(closingLightboxPath, document.getElementById('lightboxVideo'), {
          preferredSurface: 'grid',
          shouldResume: isSharedVideoPlaybackActive(document.getElementById('lightboxVideo')),
        });
        pauseSharedVideoElement(document.getElementById('lightboxVideo'));
      }

      state.lightboxIndex = -1;
      state.lightboxPath = '';
      state.pendingLightboxDirection = 0;
      state.lightboxLoadToken += 1;
      getApp().lightboxOpen = false;
      setBodyScrollLocked(false);
      getApp().lightboxMode = '';
      getApp().lightboxPathValue = '';
      getApp().lightboxImageUrl = '';
      getApp().lightboxVideoUrl = '';
      getApp().lightboxVideoReady = false;
      getApp().lightboxVideoProgressLabel = 'Preparing video for browser playback...';
      getApp().lightboxVideoProgressValue = '0%';
      getApp().lightboxVideoProgressWidth = '0%';
      getApp().lightboxVideoErrorText = '';
      getApp().lightboxZipRootDirectories = [];
      getApp().lightboxZipFiles = [];
      getApp().lightboxZipCurrentDirectory = '';
      getApp().lightboxZipBreadcrumbs = [{ label: '/', path: '' }];
      getApp().lightboxZipLoading = false;
      getApp().lightboxZipErrorText = '';
      getApp().lightboxImageAlt = '';
      getApp().lightboxTitleValue = '';
      getApp().lightboxMetaItems = [];
      getApp().lightboxZoomMenuOpen = false;
      state.lightboxImageNaturalWidth = 0;
      state.lightboxImageNaturalHeight = 0;
      state.lightboxVideoNaturalWidth = 0;
      state.lightboxVideoNaturalHeight = 0;
      state.lightboxPanPointerId = null;
      state.lightboxPanMoved = false;
      state.archivePreviewFiles = [];
      state.archivePreviewDirectories = [];
      state.archivePreviewCurrentDirectory = '';
      resetLightboxZoom(false);
      getApp().lightboxCanPan = false;
      getApp().lightboxDragging = false;
      getApp().lightboxImageStyle = {};
      getApp().lightboxVideoStyle = {};
      syncLocationState();

      if (shouldRestoreGridVideo) {
        window.requestAnimationFrame(() => {
          syncSharedVideoSurface(closingLightboxPath, 'grid');
        });
      }
    }

    function openConfirmDialog({ title, message, confirmLabel }) {
      getApp().confirmDialogTitleText = title;
      getApp().confirmDialogMessageText = message;
      getApp().confirmDialogConfirmLabel = confirmLabel;
      getApp().confirmDialogOpen = true;
      setBodyScrollLocked(true);

      return new Promise((resolve) => {
        state.confirmDialogResolver = resolve;
      });
    }

    function openUploadConflictDialog(fileName, suggestedName) {
      getApp().uploadConflictDialogTitleText = 'File already exists';
      getApp().uploadConflictDialogMessageText = 'A file named "' + fileName + '" already exists. Overwrite it or upload with a different name.';
      getApp().uploadConflictFileName = suggestedName;
      getApp().uploadConflictDialogErrorText = '';
      getApp().uploadConflictDialogOpen = true;
      setBodyScrollLocked(true);

      return new Promise((resolve) => {
        state.uploadConflictDialogResolver = resolve;
      });
    }

    function closeConfirmDialog(result) {
      if (!state.confirmDialogResolver) {
        return;
      }

      const resolve = state.confirmDialogResolver;
      state.confirmDialogResolver = null;
      getApp().confirmDialogOpen = false;
      setBodyScrollLocked(false);
      resolve(result);
    }

    function submitUploadConflictRename() {
      const fileName = getApp().uploadConflictFileName.trim();

      if (!fileName) {
        getApp().uploadConflictDialogErrorText = 'Filename is required.';
        return;
      }

      closeUploadConflictDialog({ action: 'rename', fileName });
    }

    function closeUploadConflictDialog(result) {
      if (!state.uploadConflictDialogResolver) {
        return;
      }

      const resolve = state.uploadConflictDialogResolver;
      state.uploadConflictDialogResolver = null;
      getApp().uploadConflictDialogOpen = false;
      getApp().uploadConflictDialogErrorText = '';
      setBodyScrollLocked(false);
      resolve(result);
    }

    async function stepLightbox(direction) {
      if (getApp().lightboxMode === 'zip' || !state.visibleMediaFiles.length) {
        return;
      }

      if (getApp().lightboxMode === 'video' && state.lightboxPath) {
        storeSharedVideoPlayback(state.lightboxPath, document.getElementById('lightboxVideo'), {
          shouldResume: false,
          preferredSurface: 'lightbox',
        });
        pauseSharedVideoElement(document.getElementById('lightboxVideo'));
      }

      const nextIndex = state.lightboxIndex + direction;

      if (nextIndex < 0 || nextIndex >= state.visibleMediaFiles.length) {
        const targetPage = state.page + direction;

        if (targetPage < 1 || targetPage > state.totalPages) {
          return;
        }

        state.pendingLightboxDirection = direction;
        state.page = targetPage;
        await loadFiles();
        return;
      }

      state.lightboxIndex = nextIndex;
      state.lightboxPath = state.visibleMediaFiles[nextIndex].path;
      syncLightboxState();
    }

    function syncLightboxState() {
      if (getApp().lightboxMode === 'zip') {
        syncLocationState();
        return;
      }

      const currentFile = state.visibleMediaFiles[state.lightboxIndex];
      const session = readSession();

      if (!currentFile || !session) {
        closeLightbox();
        return;
      }

      state.lightboxPath = currentFile.path;
      getApp().lightboxPathValue = currentFile.path;
      const isImage = isImageFile(currentFile.extension);
      const mediaUrl = getMediaUrl(currentFile.path, session);
      const isVideo = isVideoFile(currentFile.extension);
      const loadToken = ++state.lightboxLoadToken;

      state.lightboxImageNaturalWidth = 0;
      state.lightboxImageNaturalHeight = 0;
      state.lightboxVideoNaturalWidth = 0;
      state.lightboxVideoNaturalHeight = 0;

      getApp().lightboxMode = isVideo ? 'video' : isImage ? 'image' : '';
      getApp().lightboxImageUrl = isImage ? mediaUrl : '';
      getApp().lightboxVideoUrl = '';
      getApp().lightboxVideoReady = false;
      getApp().lightboxVideoProgressLabel = isVideo ? 'Preparing video for browser playback...' : '0%';
      getApp().lightboxVideoProgressValue = isVideo ? '0%' : '';
      getApp().lightboxVideoProgressWidth = isVideo ? '0%' : '0%';
      getApp().lightboxVideoErrorText = '';
      getApp().lightboxImageAlt = isImage ? currentFile.name : '';
      getApp().lightboxTitleValue = currentFile.name;
      getApp().lightboxMetaItems = [
        { key: 'extension', text: '.' + (currentFile.extension || 'none'), badge: true },
        { key: 'size', text: formatBytes(currentFile.size), badge: false },
        ...(isImage && formatImageDimensions(currentFile)
          ? [{ key: 'dimensions', text: formatImageDimensions(currentFile), badge: false }]
          : []),
        { key: 'modified', text: new Date(currentFile.modifiedAt).toLocaleString(), badge: false },
        { key: 'page', text: 'Page ' + state.page + ' of ' + state.totalPages, badge: false },
      ];
      getApp().lightboxPrevDisabled = state.page <= 1 && state.lightboxIndex <= 0;
      getApp().lightboxNextDisabled = state.page >= state.totalPages && state.lightboxIndex >= state.visibleMediaFiles.length - 1;
      updateLightboxZoomControls();
      updateLightboxImageStyle();
      updateLightboxVideoStyle();
      syncLocationState();

      if (isVideo) {
        prepareLightboxVideo(currentFile, session, loadToken);
      }

      if (isImage) {
        scheduleLightboxImageLayout();
      }
    }

    function resetLightboxZoom(syncLocation = true) {
      getApp().lightboxZoomValue = LIGHTBOX_FIT_ZOOM_VALUE;
      getApp().lightboxZoomMenuOpen = false;
      updateLightboxZoomOptionLabels();
      updateLightboxZoomControls();

      if (syncLocation) {
        syncLocationState();
      }
    }

    function nudgeLightboxZoom(direction) {
      if (getApp().lightboxMode !== 'image') {
        return;
      }

      const currentZoomPercent = getCurrentLightboxZoomPercent();
      const sortedZoomOptions = getSortedLightboxZoomSteps();
      const nextOption = direction > 0
        ? sortedZoomOptions.find((option) => option.sortValue > currentZoomPercent)
        : [...sortedZoomOptions].reverse().find((option) => option.sortValue < currentZoomPercent);

      if (!nextOption) {
        return;
      }

      setLightboxZoom(nextOption.value);
    }

    function setLightboxZoom(value) {
      const lightboxCenterAnchor = captureLightboxCenterAnchor();
      const nextValue = normalizeLightboxZoomValue(value) ?? LIGHTBOX_FIT_ZOOM_VALUE;
      getApp().lightboxZoomValue = nextValue;
      getApp().lightboxZoomMenuOpen = false;
      updateLightboxZoomOptionLabels();
      updateLightboxZoomControls();
      updateLightboxImageStyle();
      syncLightboxPanAvailability();
      restoreLightboxCenterAnchor(lightboxCenterAnchor);
      syncLocationState();
    }

    function selectLightboxZoomOption(value) {
      setLightboxZoom(value);
    }

    function restoreInitialLightboxFromLocation() {
      if (!state.pendingInitialLightboxRestore || getApp().lightboxOpen || !state.initialLightboxPath) {
        return;
      }

      state.pendingInitialLightboxRestore = false;
      openLightbox(state.initialLightboxPath, { zoomValue: state.initialLightboxZoomValue });
    }

    async function openArchiveLightbox(file) {
      state.lightboxIndex = -1;
      state.lightboxPath = file.path;
      state.pendingLightboxDirection = 0;
      state.lightboxLoadToken += 1;
      getApp().lightboxOpen = true;
      getApp().lightboxMode = 'zip';
      getApp().lightboxPathValue = file.path;
      getApp().lightboxImageUrl = '';
      getApp().lightboxVideoUrl = '';
      getApp().lightboxVideoReady = false;
      getApp().lightboxVideoErrorText = '';
      getApp().lightboxImageAlt = '';
      getApp().lightboxTitleValue = file.name;
      getApp().lightboxMetaItems = [
        { key: 'extension', text: '.' + (file.extension || 'none'), badge: true },
        { key: 'size', text: formatBytes(file.size), badge: false },
        { key: 'modified', text: new Date(file.modifiedAt).toLocaleString(), badge: false },
      ];
      getApp().lightboxPrevDisabled = true;
      getApp().lightboxNextDisabled = true;
      getApp().lightboxZipLoading = true;
      getApp().lightboxZipErrorText = '';
      getApp().lightboxZipRootDirectories = [];
      getApp().lightboxZipFiles = [];
      getApp().lightboxZipCurrentDirectory = '';
      getApp().lightboxZipBreadcrumbs = [{ label: '/', path: '' }];
      state.archivePreviewFiles = [];
      state.archivePreviewDirectories = [];
      state.archivePreviewCurrentDirectory = '';
      setBodyScrollLocked(true);
      syncLocationState();

      try {
        const data = await fetchArchiveContents(file.path);

        if (!getApp().lightboxOpen || getApp().lightboxMode !== 'zip' || state.lightboxPath !== file.path) {
          return;
        }

        state.archivePreviewDirectories = data.directories || [];
        state.archivePreviewFiles = data.files || [];
        setArchivePreviewDirectory('');
      } catch (error) {
        if (!getApp().lightboxOpen || getApp().lightboxMode !== 'zip') {
          return;
        }

        getApp().lightboxZipErrorText = error.message || 'Failed to read archive contents.';
      } finally {
        if (getApp().lightboxOpen && getApp().lightboxMode === 'zip') {
          getApp().lightboxZipLoading = false;
        }
      }
    }

    async function fetchArchiveContents(filePath) {
      const response = await fetch(getArchiveContentsUrl(filePath, readSession()), {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        forceLogout('Session expired. Please log in again.');
        throw new Error('Session expired. Please log in again.');
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to read archive contents.');
      }

      return data;
    }

    function getArchivePreviewDirectories() {
      return state.archivePreviewDirectories.filter((directory) => directory.parentPath === state.archivePreviewCurrentDirectory);
    }

    function getArchivePreviewFiles() {
      return state.archivePreviewFiles.filter((file) => file.parentPath === state.archivePreviewCurrentDirectory);
    }

    function setArchivePreviewDirectory(relativePath) {
      const normalizedPath = normalizeClientRelativeDirectory(relativePath || '');

      if (normalizedPath && !state.archivePreviewDirectories.some((directory) => directory.path === normalizedPath)) {
        return;
      }

      state.archivePreviewCurrentDirectory = normalizedPath;
      getApp().lightboxZipCurrentDirectory = normalizedPath;
      getApp().lightboxZipRootDirectories = getArchivePreviewDirectories();
      getApp().lightboxZipFiles = getArchivePreviewFiles();
      getApp().lightboxZipBreadcrumbs = buildArchiveBreadcrumbs(normalizedPath);
    }

    function buildArchiveBreadcrumbs(relativePath) {
      const segments = relativePath ? relativePath.split('/') : [];
      const items = [{ label: '/', path: '' }];
      let currentPath = '';

      for (const segment of segments) {
        currentPath = currentPath ? currentPath + '/' + segment : segment;
        items.push({ label: segment, path: currentPath });
      }

      return items;
    }

    function updateLightboxZoomControls() {
      if (getApp().lightboxMode !== 'image') {
        getApp().lightboxZoomOutDisabled = true;
        getApp().lightboxZoomInDisabled = true;
        return;
      }

      const currentZoomPercent = getCurrentLightboxZoomPercent();
      const sortedZoomOptions = getSortedLightboxZoomSteps();
      getApp().lightboxZoomOutDisabled = !sortedZoomOptions.some((option) => option.sortValue < currentZoomPercent);
      getApp().lightboxZoomInDisabled = !sortedZoomOptions.some((option) => option.sortValue > currentZoomPercent);
    }

    function scheduleLightboxImageLayout() {
      if (!getApp().lightboxOpen || getApp().lightboxMode !== 'image') {
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          updateLightboxZoomOptionLabels();
          updateLightboxZoomControls();
          updateLightboxImageStyle();
          syncLightboxPanAvailability();
        });
      });
    }

    function scheduleLightboxVideoLayout() {
      if (!getApp().lightboxOpen || getApp().lightboxMode !== 'video') {
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          updateLightboxVideoStyle();
        });
      });
    }

    function syncLightboxImageMetrics(imageElement) {
      if (!imageElement) {
        return;
      }

      state.lightboxImageNaturalWidth = imageElement.naturalWidth || 0;
      state.lightboxImageNaturalHeight = imageElement.naturalHeight || 0;
      updateLightboxZoomOptionLabels();
      updateLightboxZoomControls();
      updateLightboxImageStyle();
      syncLightboxPanAvailability();
    }

    function syncLightboxVideoMetrics(videoElement) {
      if (!(videoElement instanceof HTMLVideoElement)) {
        return;
      }

      state.lightboxVideoNaturalWidth = videoElement.videoWidth || 0;
      state.lightboxVideoNaturalHeight = videoElement.videoHeight || 0;
      updateLightboxVideoStyle();
    }

    function buildLightboxZoomOptions(fitZoomPercent) {
      const roundedFitZoomPercent = Math.round(fitZoomPercent);
      return [
        { value: LIGHTBOX_FIT_ZOOM_VALUE, label: roundedFitZoomPercent + '%', sortValue: fitZoomPercent },
        ...LIGHTBOX_ZOOM_LEVELS.map((level) => ({ value: String(level), label: level + '%', sortValue: level })),
      ].sort((left, right) => left.sortValue - right.sortValue);
    }

    function updateLightboxZoomOptionLabels() {
      getApp().lightboxZoomOptions = buildLightboxZoomOptions(getFitHeightZoomPercent());
    }

    function getSortedLightboxZoomSteps() {
      return buildLightboxZoomOptions(getFitHeightZoomPercent());
    }

    function getLightboxImageMaxHeight() {
      const lightboxShell = document.getElementById('lightboxShell');
      const lightboxHeader = document.getElementById('lightboxHeader');

      if (!lightboxShell || !lightboxHeader) {
        return 0;
      }

      const shellStyles = window.getComputedStyle(lightboxShell);
      const verticalGap = parseFloat(shellStyles.rowGap || shellStyles.gap || '0') || 0;
      return Math.max(0, lightboxShell.clientHeight - lightboxHeader.offsetHeight - verticalGap);
    }

    function getLightboxMediaMaxWidth() {
      const lightboxBackdrop = document.getElementById('lightboxBackdrop');
      return lightboxBackdrop ? Math.max(0, lightboxBackdrop.clientWidth) : 0;
    }

    function getCurrentLightboxZoomPercent() {
      if (getApp().lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE) {
        return getFitHeightZoomPercent();
      }

      const explicitZoomPercent = Number(getApp().lightboxZoomValue);
      return Number.isFinite(explicitZoomPercent) ? explicitZoomPercent : 100;
    }

    function captureLightboxCenterAnchor() {
      const lightboxBackdrop = document.getElementById('lightboxBackdrop');

      if (!lightboxBackdrop) {
        return null;
      }

      const centerX = lightboxBackdrop.scrollLeft + (lightboxBackdrop.clientWidth / 2);
      const centerY = lightboxBackdrop.scrollTop + (lightboxBackdrop.clientHeight / 2);
      const scrollWidth = lightboxBackdrop.scrollWidth;
      const scrollHeight = lightboxBackdrop.scrollHeight;

      return {
        centerRatioX: scrollWidth > 0 ? centerX / scrollWidth : 0.5,
        centerRatioY: scrollHeight > 0 ? centerY / scrollHeight : 0.5,
      };
    }

    function restoreLightboxCenterAnchor(anchor) {
      if (!anchor) {
        return;
      }

      window.requestAnimationFrame(() => {
        const lightboxBackdrop = document.getElementById('lightboxBackdrop');

        if (!lightboxBackdrop) {
          return;
        }

        const nextCenterX = lightboxBackdrop.scrollWidth * anchor.centerRatioX;
        const nextCenterY = lightboxBackdrop.scrollHeight * anchor.centerRatioY;
        lightboxBackdrop.scrollLeft = Math.max(0, nextCenterX - (lightboxBackdrop.clientWidth / 2));
        lightboxBackdrop.scrollTop = Math.max(0, nextCenterY - (lightboxBackdrop.clientHeight / 2));
      });
    }

    function getFitHeightZoomPercent() {
      const currentFile = state.visibleMediaFiles[state.lightboxIndex] ?? null;
      const sourceHeight = state.lightboxImageNaturalHeight || Number(currentFile?.height) || 0;

      if (!sourceHeight) {
        return 100;
      }

      const maxHeight = getLightboxImageMaxHeight();

      if (!maxHeight) {
        return 100;
      }

      return Math.max(1, Math.min(100, (maxHeight / sourceHeight) * 100));
    }

    function updateLightboxImageStyle() {
      if (getApp().lightboxMode !== 'image') {
        getApp().lightboxImageStyle = {};
        getApp().lightboxCanPan = false;
        return;
      }

      const maxHeight = getLightboxImageMaxHeight();

      if (getApp().lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE) {
        getApp().lightboxImageStyle = {
          width: 'auto',
          height: 'auto',
          maxWidth: 'none',
          maxHeight: maxHeight > 0 ? maxHeight + 'px' : '100%',
        };
        return;
      }

      const zoomPercent = Number(getApp().lightboxZoomValue);
      const zoomScale = Number.isFinite(zoomPercent) ? zoomPercent / 100 : 1;
      const naturalWidth = state.lightboxImageNaturalWidth;
      const naturalHeight = state.lightboxImageNaturalHeight;

      if (!naturalWidth || !naturalHeight) {
        getApp().lightboxImageStyle = {
          width: 'auto',
          height: 'auto',
          maxWidth: 'none',
          maxHeight: maxHeight > 0 ? maxHeight + 'px' : '100%',
        };
        return;
      }

      getApp().lightboxImageStyle = {
        width: Math.max(1, Math.round(naturalWidth * zoomScale)) + 'px',
        height: Math.max(1, Math.round(naturalHeight * zoomScale)) + 'px',
        maxWidth: 'none',
        maxHeight: 'none',
      };
    }

    function updateLightboxVideoStyle() {
      if (getApp().lightboxMode !== 'video') {
        getApp().lightboxVideoStyle = {};
        return;
      }

      const maxHeight = getLightboxImageMaxHeight();
      const maxWidth = getLightboxMediaMaxWidth();
      const naturalWidth = state.lightboxVideoNaturalWidth;
      const naturalHeight = state.lightboxVideoNaturalHeight;

      if (!maxHeight || !maxWidth || !naturalWidth || !naturalHeight) {
        getApp().lightboxVideoStyle = {
          width: 'auto',
          height: 'auto',
          maxWidth: '100%',
          maxHeight: maxHeight > 0 ? maxHeight + 'px' : '100%',
        };
        return;
      }

      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));

      getApp().lightboxVideoStyle = {
        width: width + 'px',
        height: height + 'px',
        maxWidth: '100%',
        maxHeight: maxHeight + 'px',
      };
    }

    function syncLightboxPanAvailability() {
      if (getApp().lightboxMode !== 'image') {
        getApp().lightboxCanPan = false;
        getApp().lightboxDragging = false;
        return;
      }

      window.requestAnimationFrame(() => {
        const lightboxBackdrop = document.getElementById('lightboxBackdrop');

        if (!lightboxBackdrop || getApp().lightboxMode !== 'image') {
          getApp().lightboxCanPan = false;
          getApp().lightboxDragging = false;
          return;
        }

        const canPan = lightboxBackdrop.scrollWidth > lightboxBackdrop.clientWidth
          || lightboxBackdrop.scrollHeight > lightboxBackdrop.clientHeight;

        getApp().lightboxCanPan = canPan;

        if (!canPan) {
          getApp().lightboxDragging = false;
          state.lightboxPanPointerId = null;
        }
      });
    }

    function startLightboxPan(event) {
      if (!getApp().lightboxCanPan || event.button !== 0) {
        return;
      }

      const lightboxBackdrop = document.getElementById('lightboxBackdrop');

      if (!lightboxBackdrop) {
        return;
      }

      state.lightboxPanPointerId = event.pointerId;
      state.lightboxPanStartX = event.clientX;
      state.lightboxPanStartY = event.clientY;
      state.lightboxPanScrollLeft = lightboxBackdrop.scrollLeft;
      state.lightboxPanScrollTop = lightboxBackdrop.scrollTop;
      state.lightboxPanMoved = false;
      getApp().lightboxDragging = true;
      lightboxBackdrop.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function handleLightboxBackdropClick(event) {
      if (state.lightboxPanMoved) {
        event.preventDefault();
        return;
      }

      closeLightbox();
    }

    function moveLightboxPan(event) {
      if (!getApp().lightboxDragging || state.lightboxPanPointerId !== event.pointerId) {
        return;
      }

      const lightboxBackdrop = document.getElementById('lightboxBackdrop');

      if (!lightboxBackdrop) {
        endLightboxPan(event);
        return;
      }

      const deltaX = event.clientX - state.lightboxPanStartX;
      const deltaY = event.clientY - state.lightboxPanStartY;
      lightboxBackdrop.scrollLeft = state.lightboxPanScrollLeft - deltaX;
      lightboxBackdrop.scrollTop = state.lightboxPanScrollTop - deltaY;

      if (!state.lightboxPanMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        state.lightboxPanMoved = true;
      }

      event.preventDefault();
    }

    function endLightboxPan(event) {
      if (state.lightboxPanPointerId !== event.pointerId) {
        return;
      }

      const lightboxBackdrop = document.getElementById('lightboxBackdrop');

      if (lightboxBackdrop?.hasPointerCapture(event.pointerId)) {
        lightboxBackdrop.releasePointerCapture(event.pointerId);
      }

      state.lightboxPanPointerId = null;
      getApp().lightboxDragging = false;

      window.setTimeout(() => {
        state.lightboxPanMoved = false;
      }, 0);
    }

    function prepareLightboxVideo(file, session, loadToken) {
      const entry = getVideoPreparationEntry(file.path, file.extension);
      syncLightboxVideoPreparation(file.path, entry, session, loadToken);
      ensureVideoPreparation(file.path, file.extension, loadToken);
    }

    function primeVisibleVideoPreparations(files) {
      for (const file of files) {
        if (!isVideoFile(file.extension)) {
          continue;
        }

        getVideoPreparationEntry(file.path, file.extension);

        if (getApp().viewMode === 'grid') {
          ensureVideoPreparation(file.path, file.extension);
        }
      }
    }

    function getVideoPreparationEntry(filePath, extension) {
      const existing = state.videoPreparationByPath.get(filePath);

      if (existing) {
        return existing;
      }

      const entry = {
        ready: !videoRequiresPreparation(extension),
        requiresConversion: videoRequiresPreparation(extension),
        progress: videoRequiresPreparation(extension) ? 0 : 100,
        message: videoRequiresPreparation(extension) ? 'Preparing video for browser playback...' : 'Video ready',
        error: '',
        pollingPromise: null,
      };

      state.videoPreparationByPath.set(filePath, entry);
      return entry;
    }

    function updateVideoPreparationEntry(filePath, extension, nextValues) {
      const current = getVideoPreparationEntry(filePath, extension);
      Object.assign(current, nextValues);
      getApp().videoPreparationVersion += 1;

      if (state.lightboxPath === filePath) {
        syncLightboxVideoPreparation(filePath, current, readSession(), state.lightboxLoadToken);
      }
    }

    function videoRequiresPreparation(extension) {
      return isVideoFile(extension) && String(extension || '').toLowerCase() !== 'webm';
    }

    function isGridVideoReady(file) {
      return getVideoPreparationEntry(file.path, file.extension).ready;
    }

    function getGridVideoUrl(file) {
      return isGridVideoReady(file) ? getMediaUrl(file.path, readSession()) : '';
    }

    function syncLightboxVideoPreparation(filePath, entry, session, loadToken) {
      if (
        state.lightboxLoadToken !== loadToken
        || state.lightboxPath !== filePath
        || !getApp().lightboxOpen
        || getApp().lightboxMode !== 'video'
      ) {
        return;
      }

      const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));
      getApp().lightboxVideoProgressLabel = entry.message || 'Preparing video for browser playback...';
      getApp().lightboxVideoProgressValue = progress + '%';
      getApp().lightboxVideoProgressWidth = progress + '%';
      getApp().lightboxVideoErrorText = entry.error || '';

      if (entry.ready && session) {
        getApp().lightboxVideoUrl = getMediaUrl(filePath, session);
        getApp().lightboxVideoReady = true;
        window.requestAnimationFrame(() => {
          if (state.lightboxPath !== filePath || !getApp().lightboxOpen) {
            return;
          }

          syncSharedVideoSurface(filePath, 'lightbox');
        });
        return;
      }

      getApp().lightboxVideoUrl = '';
      getApp().lightboxVideoReady = false;
    }

    function ensureVideoPreparation(filePath, extension, loadToken = 0) {
      const entry = getVideoPreparationEntry(filePath, extension);

      if (!entry.requiresConversion || entry.ready) {
        return Promise.resolve(entry);
      }

      if (entry.pollingPromise) {
        return entry.pollingPromise;
      }

      const pollingPromise = pollVideoPreparation(filePath, extension, loadToken)
        .finally(() => {
          updateVideoPreparationEntry(filePath, extension, { pollingPromise: null });
        });

      updateVideoPreparationEntry(filePath, extension, { pollingPromise });
      return pollingPromise;
    }

    async function pollVideoPreparation(filePath, extension, loadToken) {
      try {
        while (true) {
          const status = await fetchVideoPreparation(filePath);
          const progress = Math.max(0, Math.min(100, Number(status.progress) || 0));

          updateVideoPreparationEntry(filePath, extension, {
            ready: Boolean(status.ready),
            requiresConversion: status.requiresConversion !== false,
            progress,
            message: status.message || 'Preparing video for browser playback...',
            error: status.error || '',
          });

          if (status.ready || status.error) {
            return status;
          }

          if (loadToken && (state.lightboxLoadToken !== loadToken || state.lightboxPath !== filePath || !getApp().lightboxOpen)) {
            return status;
          }

          await delay(400);
        }
      } catch (error) {
        updateVideoPreparationEntry(filePath, extension, {
          error: error.message || 'Failed to prepare video.',
          message: 'Preparing video for browser playback...',
        });
        throw error;
      }
    }

    async function fetchVideoPreparation(filePath) {
      const query = new URLSearchParams({ path: filePath });
      const response = await fetch('/api/video-preparation?' + query.toString(), {
        headers: getAuthHeaders(),
      });

      if (response.status === 401) {
        forceLogout('Session expired. Please log in again.');
        throw new Error('Session expired. Please log in again.');
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to prepare video.');
      }

      return data;
    }

    function delay(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    }

    function getMediaUrl(filePath, session) {
      const query = new URLSearchParams({ path: filePath });

      if (AUTH_CONFIG.enabled && session?.token) {
        query.set('token', session.token);
      }

      return '/media?' + query.toString();
    }

    function getThumbnailUrl(filePath, session) {
      const query = new URLSearchParams({ path: filePath });

      if (AUTH_CONFIG.enabled && session?.token) {
        query.set('token', session.token);
      }

      return '/thumbnail?' + query.toString();
    }

    function getDownloadUrl(filePath, session) {
      const query = new URLSearchParams({ path: filePath });

      if (AUTH_CONFIG.enabled && session?.token) {
        query.set('token', session.token);
      }

      return '/download?' + query.toString();
    }

    function getArchiveContentsUrl(filePath, session) {
      const query = new URLSearchParams({ path: filePath });

      if (AUTH_CONFIG.enabled && session?.token) {
        query.set('token', session.token);
      }

      return '/api/archive-contents?' + query.toString();
    }

    function getArchiveEntryDownloadUrl(filePath, entryPath, session) {
      const query = new URLSearchParams({ path: filePath, entry: entryPath });

      if (AUTH_CONFIG.enabled && session?.token) {
        query.set('token', session.token);
      }

      return '/archive-entry-download?' + query.toString();
    }

    function updateSelectedCount() {
      getApp().selectedCountText = state.selectedFiles.size + ' selected';
      getApp().selectedFilePaths = [...state.selectedFiles];
      getApp().hasSelection = state.selectedFiles.size > 0;
    }

    function navigateToDirectory(relativePath) {
      if (!readSession()) {
        forceLogout('Session expired. Please log in again.');
        return;
      }

      if (state.currentDir !== relativePath) {
        state.selectedFiles.clear();
        updateSelectedCount();
      }

      state.currentDir = relativePath;
      syncLocationState();
      state.page = 1;
      loadExtensions().then(() => loadFiles());
    }

    function getDownloadFileName(contentDisposition) {
      const match = contentDisposition && contentDisposition.match(/filename="([^"]+)"/i);
      return match ? match[1] : 'download.zip';
    }

  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
