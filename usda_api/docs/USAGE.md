# USDA API Usage

## Authentication

All `/api/v1/*` endpoints require an API key.

Headers:

- `x-api-key: <key>`
- or `Authorization: Bearer <key>`

## Food search

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://usfooddb.translife.online/api/v1/foods/search?q=apple&limit=10"
```

Query parameters:

- `q` (string): partial match on description (case-insensitive)
- `dataType` (string): e.g. `branded_food`, `foundation_food`, etc.
- `limit` (1..500)
- `offset` (>=0)
- `includeSql=1` to include the SQL used

## Food nutrients by fdc_id

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://usfooddb.translife.online/api/v1/foods/1105904/nutrients?limit=50"
```

Parameters:

- `limit` (1..2000)
- `minAmount` (float)

## Branded search (UPC)

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://usfooddb.translife.online/api/v1/branded/search?upc=041631000564&limit=10"
```

## SQL debug

`/api/v1/debug/sql-history` is protected by API key and returns recent SQL executed.

