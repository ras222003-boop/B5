# B6 official map import: Basira JSON v1

The only executable map import format is structured **Basira JSON v1**. The target building already exists and belongs to the organization. It may have floors only when their IDs, numbers and names match the import exactly; it must have no places, nodes or edges. Importing into a populated operational map is rejected for manual review. Coordinates are local metres, not latitude/longitude. The backend accepts at most 1 MB of JSON, 100 floors, 1,000 places, 1,500 nodes and 3,000 edges.

```json
{
  "format": "BASIRA_JSON",
  "version": 1,
  "floors": [{ "id": "11111111-1111-4111-8111-111111111111", "floorNumber": 0, "name": "Ground" }],
  "places": [{ "id": "22222222-2222-4222-8222-222222222222", "floorId": "11111111-1111-4111-8111-111111111111", "name": "Room 121", "roomNumber": "121", "placeType": "CLASSROOM", "x": 5, "y": 0, "accessibilityInformation": "Confirm door sign" }],
  "nodes": [
    { "id": "33333333-3333-4333-8333-333333333333", "floorId": "11111111-1111-4111-8111-111111111111", "x": 0, "y": 0, "nodeType": "ENTRANCE", "accessibilityLevel": "ACCESSIBLE" },
    { "id": "44444444-4444-4444-8444-444444444444", "floorId": "11111111-1111-4111-8111-111111111111", "placeId": "22222222-2222-4222-8222-222222222222", "x": 5, "y": 0, "nodeType": "ROOM", "accessibilityLevel": "ACCESSIBLE" }
  ],
  "edges": [{ "id": "55555555-5555-4555-8555-555555555555", "fromNodeId": "33333333-3333-4333-8333-333333333333", "toNodeId": "44444444-4444-4444-8444-444444444444", "distanceMeters": 5, "pathType": "CORRIDOR", "accessibilityLevel": "ACCESSIBLE", "wheelchairAccessible": true, "visuallyImpairedFriendly": true }]
}
```

Send the document to `POST /api/navigation/organizations/:orgId/buildings/:buildingId/imports`. A valid response creates a **pending draft** and returns counts, errors and warnings; invalid input returns 422 and writes no draft. `GET` on the same path lists draft previews. An authorized reviewer or organization admin must call `POST .../imports/:importId/approve` explicitly. Approval revalidates the stored document and hash under a database transaction. It writes the graph, advances `MapVersion`, and records an audit event. An ordinary user, viewer or mapper cannot approve. Organization verification and organization-admin grants require a global admin.

The validator rejects duplicate IDs and floor numbers, missing floors/nodes, dangling edges, self-loops, wrong-floor place links and unsupported cross-floor transitions. It warns on disconnected nodes, missing accessibility notes and unlabelled transition endpoints. Warnings require human review; a successful schema check is not proof of a safe route. The source and reviewer appear in the version history.

IMDF, generic GeoJSON, SVG, PDF, DWG, DXF, CAD, BIM and IFC are **reference only** in this version. Their geometry does not automatically supply verified indoor topology, entrances, floor transitions or accessibility. No arbitrary file execution or automatic plan-image-to-graph conversion exists.
