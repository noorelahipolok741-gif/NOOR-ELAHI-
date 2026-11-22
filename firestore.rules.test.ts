/**
 * Security Rules Verification Spec for NOOR ELAHI Firestore Rules.
 * Covers the Dirty Dozen adversarial payloads against Identity, Integrity, and State.
 */
export const dirtyDozenSecurityCases = [
  { name: 'Unauthenticated read on /subjects/eng-1', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user PII read on /users/otherUid', expected: 'PERMISSION_DENIED' },
  { name: 'Self-assigned admin role on /users/{uid} create', expected: 'PERMISSION_DENIED' },
  { name: 'Privilege escalation on /users/{uid} update', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow field injection (isVerified: true) on /users/{uid}', expected: 'PERMISSION_DENIED' },
  { name: 'Non-admin write to /subjects/eng-1', expected: 'PERMISSION_DENIED' },
  { name: 'Non-admin read/list on /adminInbox', expected: 'PERMISSION_DENIED' },
  { name: 'Non-admin delete on /adminInbox/{id}', expected: 'PERMISSION_DENIED' },
  { name: 'UID spoofing on /adminInbox/{id} create', expected: 'PERMISSION_DENIED' },
  { name: 'Unverified email admin claim spoof', expected: 'PERMISSION_DENIED' },
  { name: 'Oversized payload / ID poisoning (>128 chars ID)', expected: 'PERMISSION_DENIED' },
  { name: 'Non-admin read/write on /adminConfig/vault', expected: 'PERMISSION_DENIED' },
] as const;
