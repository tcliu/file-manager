declare global {
  namespace App {
    interface Locals {
      session: { username: string; token: string; lastActiveAt: number } | null;
    }
  }

  var __fileManagerSessions: Map<string, { username: string; lastActiveAt: number }> | undefined;
  var __pendingZipDownloads: Map<string, { path: string; filename: string; expiresAt: number }> | undefined;
}

export {};
