import { registerPlugin } from '@capacitor/core';

export interface NativeGoogleAuthResult {
  accessToken: string;
  expiresAt?: number;
  grantedScopes?: string[];
  email?: string;
  name?: string;
}

interface GoogleAuthPlugin {
  signIn(options: { scopes: string[] }): Promise<NativeGoogleAuthResult>;
  signOut(): Promise<void>;
}

const GoogleAuth = registerPlugin<GoogleAuthPlugin>('GoogleAuth');

export function isNativeGoogleAuth(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export async function nativeGoogleSignIn(scopes: string[]): Promise<NativeGoogleAuthResult> {
  return GoogleAuth.signIn({ scopes });
}

export async function nativeGoogleSignOut(): Promise<void> {
  await GoogleAuth.signOut();
}
