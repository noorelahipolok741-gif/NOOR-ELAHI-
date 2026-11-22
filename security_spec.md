# Security Specification — NOOR ELAHI

## 1. Data Invariants
1. Only authenticated, email-verified Admin (`noorelahipolok741@gmail.com` or `/admins/{uid}`) may create, update, or delete `/subjects/{subjectId}`, `/notifications/{notifId}`, and `/adminConfig/{configId}`, or read/delete `/adminInbox/{messageId}`.
2. Users may only read and write their own `/users/{userId}`, `/users/{userId}/progress/{itemId}`, and `/users/{userId}/downloads/{itemId}` documents.
3. Users cannot self-assign `role: 'admin'` on profile creation or escalate their `role` on profile update.
4. Every `createdAt` and `updatedAt` timestamp must equal `request.time`, and `createdAt` and `uid` are immutable after creation.
5. Every `adminInbox` message created by a user must bind `uid == request.auth.uid`, preventing impersonation.

## 2. Dirty Dozen Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/subjects/eng-1` -> DENIED
2. Student reading another user's `/users/otherUid` -> DENIED
3. Student self-assigning `role: 'admin'` during `/users/{uid}` create -> DENIED
4. Student escalating `role: 'admin'` during `/users/{uid}` update -> DENIED
5. Student injecting shadow field `isVerified: true` in `/users/{uid}` -> DENIED
6. Student writing `/subjects/eng-1` -> DENIED
7. Student reading or listing `/adminInbox` -> DENIED
8. Student deleting `/adminInbox/msg1` -> DENIED
9. Student forging `uid: 'victimUid'` in `/adminInbox/msg1` create -> DENIED
10. Spoofed admin token with `email_verified: false` -> DENIED
11. Resource poisoning with oversized 200KB string in `name` or `subjectId` -> DENIED
12. Student reading `/adminConfig/vault` -> DENIED
