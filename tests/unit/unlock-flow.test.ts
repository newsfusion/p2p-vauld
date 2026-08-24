/**
 * Tests for lock/unlock message types and flow.
 */

import { describe, it, expect } from 'vitest';
import type {
  GetLockStatusMessage,
  LockMessage,
  LockStatusResponse,
  BackgroundMessage,
} from '../../src/shared/messages.js';

describe('Lock status message types', () => {
  it('GetLockStatusMessage has correct type', () => {
    const msg: GetLockStatusMessage = { type: 'GET_LOCK_STATUS' };
    expect(msg.type).toBe('GET_LOCK_STATUS');
  });

  it('LockMessage has correct type', () => {
    const msg: LockMessage = { type: 'LOCK' };
    expect(msg.type).toBe('LOCK');
  });

  it('LockStatusResponse has locked and hasMasterPassword fields', () => {
    const unlocked: LockStatusResponse = { locked: false, hasMasterPassword: false };
    expect(unlocked.locked).toBe(false);
    expect(unlocked.hasMasterPassword).toBe(false);

    const locked: LockStatusResponse = { locked: true, hasMasterPassword: true };
    expect(locked.locked).toBe(true);
    expect(locked.hasMasterPassword).toBe(true);
  });

  it('BackgroundMessage union includes GET_LOCK_STATUS', () => {
    const msg: BackgroundMessage = { type: 'GET_LOCK_STATUS' };
    expect(msg.type).toBe('GET_LOCK_STATUS');
  });

  it('BackgroundMessage union includes LOCK', () => {
    const msg: BackgroundMessage = { type: 'LOCK' };
    expect(msg.type).toBe('LOCK');
  });
});
