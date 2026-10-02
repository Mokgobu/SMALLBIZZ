# SmallBizz production readiness

This document is a pre-deployment checklist. It does not authorize or perform a deployment, migration, production write, or email send.

## Required Firebase services

- Firebase Authentication with Email/Password enabled and production authorized domains configured.
- Cloud Firestore in the intended production region, with `firestore.rules` and `firestore.indexes.json` reviewed together.
- Cloud Functions for Firebase, Node 20 runtime, deployed in `africa-south1` unless the client and Functions configuration are deliberately changed together.
- Firebase App Check with reCAPTCHA Enterprise for the web application. Privileged callable Functions enforce App Check outside the emulator.
- Google Cloud Secret Manager for the invitation email API key.
- Firebase Storage only if file-backed application features are enabled; apply separate least-privilege Storage Rules before use.
- A hosting service capable of SPA fallback to `index.html` and HTTPS. Firebase Hosting is suitable but is not required by the application architecture.

Production Functions require a billing plan that supports the chosen Functions runtime, outbound email-provider access, and Secret Manager.

## Browser environment variables

Copy `.env.example` to a local, ignored environment file and supply:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_APP_CHECK_SITE_KEY` (required in production)

Firebase web configuration and the App Check site key are public identifiers, not server credentials. Never place email-provider keys, service-account JSON, private keys, or Admin SDK credentials in a `VITE_` variable. `VITE_USE_FIREBASE_EMULATORS` must be absent or `false` in production. The application also refuses emulator mode unless the project ID begins with `demo-`.

Missing browser configuration produces a branded, retryable SmallBizz error state. Technical exception details are not rendered to customers.

## Functions parameters and secrets

Set these non-secret Functions parameters to production values:

- `STAFF_INVITE_EMAIL_FROM`
- `STAFF_INVITE_SUPPORT_EMAIL`
- `STAFF_INVITE_APP_URL` (the HTTPS production application origin)

Set `STAFF_INVITE_EMAIL_API_KEY` with Firebase Secret Manager. The current adapter targets Resend. Verify the sender domain, SPF/DKIM, provider sandbox restrictions, suppression handling, and support mailbox before enabling invitations. Emulator runs always use a no-network/no-delivery adapter and return invitation and password-setup URLs only in the immediate emulator callable response so the Staff screen can expose local copy actions. The links remain in component state only; they are not stored in Firestore. Production must never return invitation tokens or either testing URL.

## Firestore indexes and Rules

Deploy the checked-in Rules and indexes as one reviewed release. Current explicit compound indexes are:

- `sales`: `customerId ASC`, `createdAt DESC`
- `inventoryBatches`: `productId ASC`, `status ASC`, `expiryDate ASC`, document name `ASC`

Before production, run `npm run test:rules`. Do not create broad allow rules to work around a failed query. Verify the Firebase console reports no outstanding index links during staging QA.

## App Check

Create a reCAPTCHA Enterprise provider for the production web app, register only real application origins, and set `VITE_FIREBASE_APP_CHECK_SITE_KEY`. Confirm valid clients can call Functions and missing/invalid attestations are rejected. The emulator intentionally bypasses App Check so local automation remains deterministic; that bypass is controlled by `FUNCTIONS_EMULATOR` and is not enabled by a browser flag.

## Local emulators and E2E

Prerequisites: Node 20+, Java for the Firebase emulators, Firebase CLI dependencies from `npm install`, and Chrome. Then run:

```bash
npm install
npm run test:e2e
```

The Playwright configuration uses only `demo-smallbizz` and localhost ports `4173`, `9099`, `8080`, and `5001`. It resets emulator data between tests and never targets production. To run emulators for manual QA, use `npm run emulators` and start Vite with the emulator variables from `.env.example`.

## Verification and build

Run this gate from a clean installation:

```bash
npm run typecheck
npm run test:unit
npm run test:functions
npm run test:rules
npm run test:integration
npm run test:e2e
npm run build
```

The production artifact is `dist/`. Review Vite's chunk sizes and warnings, exercise the artifact in a staging Firebase project with App Check enforcement, and complete manual cross-browser/assistive-technology QA before deployment.

## Deployment prerequisites

- A documented production Firebase project and region decision.
- Separate staging and production projects; never reuse `demo-smallbizz` outside local tests.
- Backup/rollback procedures for Rules, indexes, Functions, and hosting.
- A reviewed privacy policy, Terms version, retention policy, and support contact.
- Monitoring and alerting for Function errors, App Check rejection spikes, Auth abuse, email failures, and Firestore usage.
- Rate-limit capacity and email-provider quotas validated against expected traffic.
- The dry-run migration reviewed separately if legacy data exists. Migration execution requires its explicit safety gate and is not part of deployment.
- All verification commands passing against the exact release candidate.

No deployment command is intentionally documented as a copy/paste final step; deployment should happen only through the project's approved release process after staging sign-off.

## Known scaling considerations

- Operational callable projections cap products at 500 and report event reads at 3,000 per collection. Large tenants need pagination or pre-aggregated reporting before exceeding those limits.
- Several CRUD screens use tenant-scoped realtime lists. Monitor read volume for large catalogs and introduce pagination only when measurements justify it.
- Kitchen uses one tenant-scoped Firestore listener capped at 100 newest tickets. It unsubscribes on tenant/component change; writes remain trusted callable operations.
- The application is currently single-business-per-user and single-branch by design. Do not infer multi-branch support from tenant isolation.
