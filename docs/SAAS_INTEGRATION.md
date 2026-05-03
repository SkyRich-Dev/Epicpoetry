# Epicpoetry SaaS Integration

This document defines how `Platr-Link` and `Epicpoetry` work together when
Epicpoetry is used as a SaaS product.

## Architecture

- `Platr-Link` is the control plane.
  - Customer signup
  - Package selection
  - Subscription purchase
  - Payment verification
  - Renew / cancel / reactivate lifecycle
- `Epicpoetry` is the product plane.
  - Cafe operations data
  - Product access enforcement
  - Local cached subscription state

`Epicpoetry` should not query the `Platr-Link` database live for every request.
Instead, `Platr-Link` pushes subscription state into Epicpoetry over secure
server-to-server API calls.

## Epicpoetry Schema

Epicpoetry stores the SaaS link in:

- [`saas.ts`](C:\work space\GitSpace\Epicpoetry\lib\db\src\schema\saas.ts)

Primary table:

- `saas_subscription_link`

Important fields:

- `platr_customer_id`
- `platr_subscription_id`
- `platr_package_id`
- `package_slug`
- `package_name`
- `plan`
- `subscription_status`
- `customer_status`
- `current_period_start`
- `current_period_end`
- `trial_ends_at`
- `cancel_at_period_end`
- `features_json`
- `billing_meta`
- `last_synced_at`
- `last_sync_source`

## Epicpoetry Internal API

Routes are defined in:

- [`internalSaas.ts`](C:\work space\GitSpace\Epicpoetry\artifacts\api-server\src\routes\internalSaas.ts)

Available endpoints:

- `GET /api/internal/saas/status`
- `POST /api/internal/saas/provision`
- `POST /api/internal/saas/subscription-sync`

These routes are protected by a shared secret from:

- `PLATR_LINK_SHARED_SECRET`

Accepted auth formats:

- `Authorization: Bearer <secret>`
- `x-platr-link-secret: <secret>`

## Epicpoetry Env

Set these on the Epicpoetry instance:

```env
PLATR_LINK_SHARED_SECRET=replace-with-shared-secret
SAAS_ENFORCEMENT_ENABLED=false
```

Notes:

- Start with `SAAS_ENFORCEMENT_ENABLED=false` while integration is being tested.
- Turn it on only after the first successful sync/provision flow is confirmed.

When enabled, Epicpoetry checks SaaS access:

- on login
- on protected API access

Enforcement logic is in:

- [`saas.ts`](C:\work space\GitSpace\Epicpoetry\artifacts\api-server\src\lib\saas.ts)

## Payload Contract

`Platr-Link` should send this JSON shape to Epicpoetry:

```json
{
  "platrCustomerId": 123,
  "platrSubscriptionId": 456,
  "platrPackageId": 2,
  "platrCustomerEmail": "owner@cafe.com",
  "platrCustomerName": "Cafe Owner",
  "companyName": "Acme Cafe",
  "packageSlug": "cafe-pro",
  "packageName": "Cafe Pro",
  "plan": "monthly",
  "subscriptionStatus": "active",
  "customerStatus": "active",
  "currentPeriodStart": "2026-05-03T00:00:00.000Z",
  "currentPeriodEnd": "2026-06-03T00:00:00.000Z",
  "trialEndsAt": null,
  "cancelAtPeriodEnd": false,
  "epicpoetryInstanceKey": "acme-cafe-prod",
  "features": {
    "module.sales": true,
    "module.inventory": true,
    "module.expenses": true
  },
  "billingMeta": {
    "provider": "razorpay"
  },
  "syncSource": "platr-link"
}
```

### Field Mapping From Platr-Link

Based on the current Platr-Link schema:

- `platrCustomerId` -> `customers.id`
- `platrSubscriptionId` -> `subscriptions.id`
- `platrPackageId` -> `packages.id`
- `platrCustomerEmail` -> `customers.email`
- `platrCustomerName` -> `customers.name`
- `companyName` -> `customers.company`
- `packageSlug` -> `packages.slug`
- `packageName` -> `packages.name`
- `plan` -> `subscriptions.plan`
- `subscriptionStatus` -> `subscriptions.status`
- `customerStatus` -> `customers.status`
- `currentPeriodStart` -> `subscriptions.currentPeriodStart`
- `currentPeriodEnd` -> `subscriptions.currentPeriodEnd`
- `cancelAtPeriodEnd` -> `subscriptions.cancelAtPeriodEnd`

`packages.features` currently exists as a string array in Platr-Link. The
recommended first version is to convert that array into a simple object map
before syncing to Epicpoetry.

Example:

```ts
function packageFeaturesToMap(features: string[] | null | undefined) {
  const list = features ?? [];
  return Object.fromEntries(list.map((feature) => [feature, true]));
}
```

## Platr-Link Hook Points

The current subscription lifecycle in Platr-Link lives in:

- [`customerBilling.ts`](C:\work space\GitSpace\Platr-Link\artifacts\api-server\src\routes\customerBilling.ts)

### 1. After successful payment verification

Current flow:

- `/customer/billing/verify`
- calls `activatePaymentAndSubscription(...)`

This is the main place to call Epicpoetry after a subscription becomes active.

Recommended hook:

- inside `activatePaymentAndSubscription(...)`
- after the subscription row is updated to `active`
- after `currentPeriodStart` and `currentPeriodEnd` are known

Why:

- This helper is already used as the canonical activation path
- It is the safest place to keep activation idempotent

### 2. After cancel at period end

Current route:

- `POST /customer/subscriptions/:id/cancel`

Recommended action:

- call `POST /api/internal/saas/subscription-sync`
- set:
  - `cancelAtPeriodEnd: true`
  - keep `subscriptionStatus` as current active value unless your business rule
    treats cancel scheduling differently

### 3. After reactivate

Current route:

- `POST /customer/subscriptions/:id/reactivate`

Recommended action:

- call `POST /api/internal/saas/subscription-sync`
- set:
  - `cancelAtPeriodEnd: false`

### 4. Future renewal / payment failure / expiry jobs

When Platr-Link adds or already has:

- renewal automation
- payment failure webhook handling
- expiry handling

those flows should also call:

- `POST /api/internal/saas/subscription-sync`

## Recommended Platr-Link Service

Create a small service module in Platr-Link, for example:

- `artifacts/api-server/src/lib/epicpoetrySaas.ts`

Suggested responsibilities:

- read `EPICPOETRY_SAAS_BASE_URL`
- read `EPICPOETRY_SAAS_SHARED_SECRET`
- build normalized payload from customer/subscription/package rows
- call Epicpoetry internal routes
- log and surface failures without breaking payment verification unnecessarily

Suggested envs in Platr-Link:

```env
EPICPOETRY_SAAS_BASE_URL=https://customer-cafe.example.com
EPICPOETRY_SAAS_SHARED_SECRET=replace-with-shared-secret
```

Example internal caller:

```ts
async function pushEpicpoetrySubscriptionSync(path: string, payload: unknown) {
  const baseUrl = process.env.EPICPOETRY_SAAS_BASE_URL?.trim();
  const secret = process.env.EPICPOETRY_SAAS_SHARED_SECRET?.trim();
  if (!baseUrl || !secret) return;

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Epicpoetry SaaS sync failed: ${response.status} ${text}`);
  }
}
```

## Provision vs Sync

Use `provision` for the first successful activation of a customer instance:

- `POST /api/internal/saas/provision`

Use `subscription-sync` for later lifecycle changes:

- renewal
- cancel schedule
- reactivate
- expired
- disabled customer
- plan change

## Access Rules In Epicpoetry

Current enforcement allows access when:

- enforcement is disabled
- subscription is `active`
- subscription is `trialing`
- or status is `pending` and `trialEndsAt` is still in the future

Current enforcement blocks access when:

- no SaaS link exists
- customer is disabled
- subscription is not active/trial
- subscription period is expired

## Rollout Plan

1. Run Epicpoetry DB sync:

```bash
npm run db:prepare
npm run db:push
```

2. Set Epicpoetry env:

```env
PLATR_LINK_SHARED_SECRET=replace-with-shared-secret
SAAS_ENFORCEMENT_ENABLED=false
```

3. Add Platr-Link outbound sync service.
4. Call Epicpoetry `provision` after first successful activation.
5. Call Epicpoetry `subscription-sync` on cancel/reactivate/lifecycle changes.
6. Test end to end with one customer instance.
7. Turn on:

```env
SAAS_ENFORCEMENT_ENABLED=true
```

## Testing Checklist

- New customer purchases package in Platr-Link
- Platr-Link activates payment/subscription
- Epicpoetry receives `provision`
- `saas_subscription_link` row is created
- Epicpoetry login works
- Cancel at period end updates Epicpoetry local link
- Reactivate updates Epicpoetry local link
- Expired subscription blocks login/API when enforcement is enabled

