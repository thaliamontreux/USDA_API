# USDA API Technical Reference

## Base URL

- Local/dev: `http://127.0.0.1:8080`
- Production (example): `https://usfooddb.translife.online`

All API endpoints are under `/api/v1/*`.

## Connectivity

- **Protocol**: HTTP/HTTPS
- **Content-Type**: JSON responses
- **Authentication**: API key required for all `/api/v1/*` routes

## Health checks (for HAProxy / Translife autodetection)

### `GET /healthz`

Designed for load balancers and module autodetection.

- **200 OK** when the process is running and DB check succeeds
- **503** when DB check fails

Response:

```json
{
  "ok": true,
  "module": "usdafooddb",
  "service": "usda-api",
  "version": "0.1.0",
  "db": true
}
```

### `GET /health`

Simple health endpoint.

```json
{ "ok": true, "db": true }
```

## Authentication

All `/api/v1/*` endpoints require an API key.

Send either header:

- `x-api-key: <key>`
- `Authorization: Bearer <key>`

If missing/invalid, the API returns **401**:

```json
{ "error": "Unauthorized" }
```

## Command structure (endpoint patterns)

This API uses a small set of consistent patterns:

- **Search/list**: `GET /resource/search?...` returns `{ items: [...], limit, offset?, count }`
- **Get one**: `GET /resource/:id` returns `{ item: {...} }`
- **Sub-resource**: `GET /resource/:id/subresource?...` returns `{ items: [...] }`

### Optional SQL debug payload

Many endpoints accept `includeSql=1` to include the SQL and parameters used:

```json
{
  "items": [],
  "count": 0,
  "sql": {
    "sql": "SELECT ... WHERE ...",
    "params": ["%apple%", 50, 0]
  }
}
```

## Common result structure

### List responses

```json
{
  "items": [ { /* row */ } ],
  "limit": 50,
  "offset": 0,
  "count": 50
}
```

Notes:

- `offset` appears on endpoints that support pagination.
- `count` is the number of items returned in this response (not total rows in DB).

### Single item responses

```json
{ "item": { /* row */ } }
```

### Errors

Most errors return:

```json
{ "error": "Message" }
```

Common HTTP statuses:

- `400` invalid input
- `401` missing/invalid API key
- `404` not found
- `503` health check DB failure
- `500` unexpected server error

## Endpoint reference

### Foods

#### `GET /api/v1/foods/search`

Query parameters:

- `q` (string, optional): case-insensitive partial match on `food.description`
- `dataType` (string, optional): matches `food.data_type` (case-insensitive)
- `limit` (int, optional, default 50, max 500)
- `offset` (int, optional, default 0)
- `includeSql=1` (optional)

Response item fields:

- `fdc_id` (number)
- `data_type` (string)
- `description` (string)
- `food_category_id` (number|null)
- `publication_date` (string|null)

Example:

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://usfooddb.translife.online/api/v1/foods/search?q=apple&limit=5"
```

#### `GET /api/v1/foods/:fdcId`

Returns the raw `food` row.

Example:

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://usfooddb.translife.online/api/v1/foods/1105904"
```

#### `GET /api/v1/foods/:fdcId/nutrients`

Query parameters:

- `limit` (int, optional, default 200, max 2000)
- `minAmount` (float, optional)
- `includeSql=1` (optional)

Response item fields:

- `food_nutrient_id`
- `fdc_id`
- `nutrient_id`
- `amount`
- `nutrient_name`
- `unit_name`
- `nutrient_nbr`
- `rank`

### Nutrients

#### `GET /api/v1/nutrients/search`

Query parameters:

- `q` (string, optional): case-insensitive partial match on `nutrient.name`
- `limit` (int, optional, default 50, max 500)
- `includeSql=1` (optional)

### Branded foods

#### `GET /api/v1/branded/search`

Query parameters:

- `upc` (string, optional): exact match on `branded_food.gtin_upc`
- `brandOwner` (string, optional): case-insensitive partial match
- `ingredients` (string, optional): case-insensitive partial match
- `limit` (int, optional, default 50, max 500)
- `offset` (int, optional, default 0)
- `includeSql=1` (optional)

Response item fields:

- `fdc_id`
- `description`
- `data_type`
- `brand_owner`
- `brand_name`
- `gtin_upc`

#### `GET /api/v1/branded/:fdcId`

Returns the raw `branded_food` row.

## Admin panel (API key rotation)

The admin UI is served at:

- `/admin`

It is protected by:

- Password login (bootstrap `admin`/`admin`, forced password change)
- MFA (TOTP and/or Passkeys)

See `docs/ADMIN_PANEL.md`.
