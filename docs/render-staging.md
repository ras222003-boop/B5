# Basira B5 staging on Render

This is a proposed deployment, not an active service. The account owner must
approve the monthly cost and public endpoint before syncing `render.yaml`.
The Blueprint creates new resources only. Never point it at a production
database or reuse production credentials.

## Resources and estimated recurring cost

| Resource | Render plan | Monthly list price (USD) |
| --- | --- | ---: |
| Hobby workspace | Hobby | $0 |
| Web and API, one instance | `1c-2g` | $25 |
| Private MySQL 8.4, one instance | `1c-2g` | $25 |
| MySQL persistent disk | 10 GB | $2.50 |
| **Base total while running** | | **$52.50** |

Render bills compute and disk pro rata. The Hobby allowance includes 5 GB
outbound bandwidth and 500 build pipeline minutes per month; overages may add
cost. The initial Docker build is large because local browser models ship with
the web app. Confirm actual checkout pricing and billing limits in Render before
creating resources. MySQL here is a private service with a disk, not Render's
managed PostgreSQL product. Arrange `mysqldump` backups before using meaningful
test data; a filesystem snapshot is not a consistent MySQL backup.

## Approval-time setup

1. Sign in or create a Render account yourself. Accept any account terms and
   enter payment information yourself. Connect GitHub with access limited to
   `ras222003-boop/B5`.
2. Review the Blueprint preview for project `basira-b5-staging-20261030`,
   environment `staging`, and two *new* services of the same prefix. The web
   service must use branch `codex/basira-ios-full-feature-catalog-20261030`.
   Automatic deployments and pull request previews must remain off.
3. Confirm the two `1c-2g` compute plans and 10 GB disk, then explicitly
   approve the cost and internet-facing staging URL before Blueprint sync.
4. Render generates separate MySQL user/root passwords and a session signing
   secret, and references the MySQL password from the private service. The
   application receives its private hostname and HTTPS origin as environment
   variables. Do not put secrets in GitHub, a Blueprint value, a build argument,
   Codemagic, or a chat message.
5. After MySQL has initialized, deploy the web service manually. It waits for
   database connectivity, applies additive schema migrations, and begins
   listening only if migration succeeds. `/api/readiness` is the health check.

The Blueprint does not configure a Forge/Manus AI key, OAuth provider keys,
SMTP credentials, payment provider, or licensed server model. Test their
absence as unavailable; do not label those capabilities as working. Google
Maps proxy integration is not in use by the route catalog; the active
navigation map uses MapLibre and OpenFreeMap tiles, which need a live network
check. Do not load production data into the staging database.

## Release acceptance checks

Use the actual Render HTTPS origin, never a guessed subdomain. Verify TLS and
that public routes do not redirect to a Manus login page. Request:

- `/api/readiness`: HTTP 200, `status=READY`, and database, authentication,
  mapCore all `READY`; optional models may remain `DEGRADED`.
- `/api/mobile-release-info`: HTTP 200, `sourceVerified=true`,
  `sourceRevision` equal to the deployed GitHub commit, and a nonempty bundle
  hash and route list.
- `/api/billing/catalog`: providers must continue to report checkout disabled.
- Public vision, exams, navigation, and assistant pages: HTTP 200 HTML with
  no cross-origin redirect, then browser smoke tests for UI errors and tiles.

Set `BASIRA_IOS_WEB_ORIGIN` to the approved HTTPS origin and run
`node scripts/check-mobile-release.mjs` to enforce the iOS release contract.
Set `BASIRA_IOS_WEB_ORIGIN` in Codemagic's
`basira_unified_ios` group only after this check passes for the same source SHA
as the iPhone build. TestFlight deployment is a separate, later action.

Sources: [Render pricing](https://render.com/pricing),
[Blueprint reference](https://render.com/docs/blueprint-spec),
[Docker environment arguments](https://render.com/docs/docker), and
[MySQL deployment and backup guidance](https://render.com/docs/deploy-mysql).
