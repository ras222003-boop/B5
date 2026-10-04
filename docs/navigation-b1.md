# Basira B1: maps and places

## Deployment

The production Express startup runs additive migration `server/migrations/0003_navigation.sql` through `ensureSchema()`. The Vite development API runs the same migration on its first navigation request. Both require the existing `DATABASE_URL` and `MANUS_JWT_SECRET` secrets. This checkout has no database connection configured, so the migration must be applied and checked in the target environment.

Map writes require a Better Auth session and a row in `basira_navigation_roles`; reads of public maps do not. A database administrator can grant the first mapper or administrator using the ID of an existing Better Auth `user`:

```sql
INSERT INTO basira_navigation_roles (user_id, role)
VALUES ('<existing-user-id>', 'admin');
```

`mapper` and `admin` both manage building data in B1. This grant is deliberately not self-service. Saved place routes always derive the owner from the authenticated session and scope every read, update, favorite, selection and deletion by `user_id`.

## API

Prefix: `/api/navigation`.

| Resource | Routes |
| --- | --- |
| Access | `GET /access` |
| Buildings | `GET /buildings`, `GET /buildings/current`, `GET /buildings/:id`, `POST /buildings`, `PATCH /buildings/:id` |
| Floors | `GET /buildings/:id/floors`, `POST /buildings/:id/floors` |
| Places | `GET /buildings/:id/places`, `POST /buildings/:id/places`, `GET /places/:id`, `PATCH /places/:id`, `GET /search` |
| Saved places | `GET /saved-places`, `POST /saved-places`, `PATCH /saved-places/:id`, `DELETE /saved-places/:id`, `POST /saved-places/:id/favorite`, `POST /saved-places/:id/select` |
| Map graph | `GET /buildings/:id/graph`, `GET/POST /buildings/:id/nodes`, `GET/POST /buildings/:id/edges` |

The search service prioritizes the current building, then the signed-in user's saved places, then official, community-verified and discovered public places. It only includes other buildings when the current building has no match or the caller sets `includeOtherBuildings=true`.

## Privacy and future stages

The browser requests foreground geolocation only after the user activates **My current location** or **Save this place**. Coordinates stay in page memory until the user explicitly saves a place. Building context and prepared destination IDs are tab-scoped in `sessionStorage`. There is no movement log or background location request. Camera, microphone, Bluetooth, motion and notification permissions are displayed but not requested in B1.

The `shared/navigation.ts` provider contracts define connection points for vision, indoor localization, depth, obstacles, navigation, automatic mapping and voice navigation. They have no B2–B5 implementations yet.
