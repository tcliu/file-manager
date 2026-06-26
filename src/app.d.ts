declare global {
  namespace App {
    interface Locals {
      session: { username: string; token: string; expiresAt: number } | null;
    }
  }

  var __fileManagerSessions: Map<string, { username: string; expiresAt: number }> | undefined;
}

export {};
