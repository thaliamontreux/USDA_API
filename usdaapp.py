import datetime
import time
from dataclasses import dataclass
from typing import Any, Optional

import pandas as pd
import streamlit as st

import mysql.connector


@dataclass
class SqlEvent:
    ts: datetime.datetime
    sql: str
    params: Optional[tuple[Any, ...]]
    elapsed_ms: int
    rowcount: Optional[int]
    error: Optional[str]


def _init_state():
    if "connected" not in st.session_state:
        st.session_state.connected = False
    if "db_password" not in st.session_state:
        st.session_state.db_password = ""
    if "sql_history" not in st.session_state:
        st.session_state.sql_history: list[SqlEvent] = []
    if "conn_params" not in st.session_state:
        st.session_state.conn_params = {
            "host": "192.168.250.212",
            "port": 3306,
            "user": "foodie",
            "database": "usdafooddb",
        }
    if "write_enabled" not in st.session_state:
        st.session_state.write_enabled = False
    if "write_confirm" not in st.session_state:
        st.session_state.write_confirm = ""


def _add_history(
    sql: str,
    params: Optional[tuple[Any, ...]],
    elapsed_ms: int,
    rowcount: Optional[int],
    error: Optional[str],
):
    st.session_state.sql_history.insert(
        0,
        SqlEvent(
            ts=datetime.datetime.now(),
            sql=sql,
            params=params,
            elapsed_ms=elapsed_ms,
            rowcount=rowcount,
            error=error,
        ),
    )
    st.session_state.sql_history = st.session_state.sql_history[:200]


def _connect(password: str):
    p = st.session_state.conn_params
    conn = mysql.connector.connect(
        host=p["host"],
        port=int(p["port"]),
        user=p["user"],
        password=password,
        database=p["database"],
        autocommit=False,
    )
    return conn


def _get_connection(password: str):
    if not password:
        raise RuntimeError("Password required")

    conn = st.session_state.get("_conn")
    if conn is not None:
        try:
            if conn.is_connected():
                return conn
        except Exception:
            pass

    conn = _connect(password)
    st.session_state._conn = conn
    return conn


def _close_connection():
    conn = st.session_state.get("_conn")
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass
    st.session_state._conn = None
    st.session_state.connected = False


def _run(
    password: str,
    sql: str,
    params: Optional[tuple[Any, ...]] = None,
    *,
    fetch: bool = True,
    commit: bool = False,
):
    t0 = time.perf_counter()
    rowcount: Optional[int] = None
    err: Optional[str] = None
    try:
        conn = _get_connection(password)
        cur = conn.cursor()
        cur.execute(sql, params)
        if commit:
            conn.commit()
        if fetch:
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall() if cur.description else []
            df = pd.DataFrame(rows, columns=cols)
        else:
            df = pd.DataFrame()
        rowcount = cur.rowcount
        return df, rowcount
    except Exception as e:
        err = repr(e)
        try:
            conn = st.session_state.get("_conn")
            if conn is not None:
                conn.rollback()
        except Exception:
            pass
        raise
    finally:
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        _add_history(sql, params, elapsed_ms, rowcount, err)


def _sql_box(title: str, sql: str, params: Optional[tuple[Any, ...]]):
    with st.expander(title, expanded=False):
        st.code(sql, language="sql")
        if params:
            st.write({"params": params})


def _is_write_sql(sql: str) -> bool:
    s = sql.strip().lower()
    prefixes = (
        "insert",
        "update",
        "delete",
        "replace",
        "create",
        "alter",
        "drop",
        "truncate",
    )
    return any(s.startswith(p) for p in prefixes)


def _require_write_enabled():
    if not st.session_state.write_enabled:
        st.error(
            "Writes are disabled. Enable writes in the sidebar to run this."
        )
        st.stop()


def _fetch_tables(password: str) -> list[str]:
    sql = (
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_type='BASE TABLE' "
        "ORDER BY table_name"
    )
    df, _ = _run(password, sql)
    return [str(x) for x in df["table_name"].tolist()]


def _fetch_columns(password: str, table: str) -> pd.DataFrame:
    sql = (
        "SELECT column_name, data_type, is_nullable, column_default, "
        "column_key, extra "
        "FROM information_schema.columns "
        "WHERE table_schema = DATABASE() AND table_name = %s "
        "ORDER BY ordinal_position"
    )
    df, _ = _run(password, sql, (table,))
    return df


def _fetch_primary_key_columns(password: str, table: str) -> list[str]:
    sql = (
        "SELECT k.column_name "
        "FROM information_schema.table_constraints t "
        "JOIN information_schema.key_column_usage k "
        "ON t.constraint_name = k.constraint_name "
        "AND t.table_schema = k.table_schema "
        "AND t.table_name = k.table_name "
        "WHERE t.table_schema = DATABASE() "
        "AND t.table_name = %s "
        "AND t.constraint_type = 'PRIMARY KEY' "
        "ORDER BY k.ordinal_position"
    )
    df, _ = _run(password, sql, (table,))
    if df.empty:
        return []
    return [str(x) for x in df["column_name"].tolist()]


def _as_widget_value(data_type: str, value: Any):
    if value is None:
        return None
    if data_type in {"int", "bigint", "smallint", "mediumint", "tinyint"}:
        try:
            return int(value)
        except Exception:
            return value
    if data_type in {"decimal", "numeric", "float", "double"}:
        try:
            return float(value)
        except Exception:
            return value
    if data_type in {"date"}:
        if isinstance(value, datetime.date):
            return value
        try:
            return datetime.date.fromisoformat(str(value))
        except Exception:
            return value
    return str(value)


def _render_value_input(
    label: str,
    data_type: str,
    nullable: bool,
    default: Any,
    value: Any,
    key: str,
):
    v = value if value is not None else default
    if data_type in {"int", "bigint", "smallint", "mediumint", "tinyint"}:
        if v is None:
            v = 0
        return st.number_input(label, value=int(v), step=1, key=key)

    if data_type in {"decimal", "numeric", "float", "double"}:
        if v is None:
            v = 0.0
        return st.number_input(label, value=float(v), key=key)

    if data_type == "date":
        if v is None:
            v = datetime.date.today()
        return st.date_input(
            label,
            value=_as_widget_value(data_type, v),
            key=key,
        )

    if data_type in {"text", "longtext", "mediumtext"}:
        return st.text_area(label, value="" if v is None else str(v), key=key)

    return st.text_input(label, value="" if v is None else str(v), key=key)


def page_home(password: str):
    st.header("USDA FoodData Central Browser")

    c1, c2, c3, c4 = st.columns(4)

    def count(table: str) -> int:
        sql = f"SELECT COUNT(*) AS c FROM {table}"
        df, _ = _run(password, sql)
        return int(df.iloc[0]["c"]) if not df.empty else 0

    with c1:
        st.metric("Foods", f"{count('food'):,}")
    with c2:
        st.metric("Nutrients", f"{count('nutrient'):,}")
    with c3:
        st.metric("Food Nutrients", f"{count('food_nutrient'):,}")
    with c4:
        st.metric("Branded Foods", f"{count('branded_food'):,}")

    st.subheader("Quick links")
    st.write(
        "Use the sidebar to navigate: Food Search, Nutrient Explorer, "
        "Branded Lookup, Table Browser, CRUD, SQL Console."
    )


def page_food_search(password: str):
    st.header("Food Search")

    left, right = st.columns([2, 1])
    with left:
        q = st.text_input("Search description", value="")
    with right:
        limit = st.number_input(
            "Limit",
            min_value=10,
            max_value=5000,
            value=200,
            step=10,
        )

    c1, c2, c3 = st.columns(3)
    with c1:
        data_type = st.selectbox(
            "Data type",
            ["(any)", "Branded", "Foundation", "SR Legacy", "Survey (FNDDS)"],
            index=0,
        )
    with c2:
        fdc_min = st.text_input("fdc_id >=", value="")
    with c3:
        fdc_max = st.text_input("fdc_id <=", value="")

    where = []
    params: list[Any] = []

    if q.strip():
        where.append("f.description LIKE %s")
        params.append(f"%{q.strip()}%")

    dt_map = {
        "Branded": "branded_food",
        "Foundation": "foundation_food",
        "SR Legacy": "sr_legacy_food",
        "Survey (FNDDS)": "survey_fndds_food",
    }
    if data_type != "(any)":
        where.append("f.data_type = %s")
        params.append(dt_map[data_type])

    if fdc_min.strip().isdigit():
        where.append("f.fdc_id >= %s")
        params.append(int(fdc_min.strip()))

    if fdc_max.strip().isdigit():
        where.append("f.fdc_id <= %s")
        params.append(int(fdc_max.strip()))

    where_sql = (
        " AND ".join(where) if where else "1=1"
    )

    sql = (
        "SELECT f.fdc_id, f.data_type, f.description, "
        "COALESCE(f.food_category, CAST(f.food_category_id AS CHAR)) "
        "AS category, "
        "f.publication_date "
        "FROM food f "
        f"WHERE {where_sql} "
        "ORDER BY f.fdc_id DESC "
        "LIMIT %s"
    )
    params2 = tuple(
        params + [int(limit)]
    )

    _sql_box("SQL", sql, params2)

    if st.button("Search", type="primary"):
        df, _ = _run(password, sql, params2)
        st.dataframe(df, use_container_width=True, height=500)

        if not df.empty:
            selected = st.selectbox(
                "Select fdc_id to view details",
                df["fdc_id"].tolist(),
            )
            if selected:
                st.subheader(f"Food {selected}")
                sql2 = "SELECT * FROM food WHERE fdc_id = %s"
                _sql_box("SQL (food)", sql2, (int(selected),))
                d2, _ = _run(password, sql2, (int(selected),))
                st.dataframe(d2, use_container_width=True)

                st.subheader("Top nutrients")
                sql3 = (
                    "SELECT n.id AS nutrient_id, n.name, n.unit_name, fn.amount "
                    "FROM food_nutrient fn "
                    "JOIN nutrient n ON n.id = fn.nutrient_id "
                    "WHERE fn.fdc_id = %s "
                    "ORDER BY fn.amount DESC "
                    "LIMIT 100"
                )
                _sql_box("SQL (nutrients)", sql3, (int(selected),))
                d3, _ = _run(password, sql3, (int(selected),))
                st.dataframe(d3, use_container_width=True, height=450)


def page_nutrient_explorer(password: str):
    st.header("Nutrient Explorer")

    c1, c2 = st.columns([2, 1])
    with c1:
        nq = st.text_input("Nutrient name contains", value="protein")
    with c2:
        limit = st.number_input(
            "Limit",
            min_value=10,
            max_value=2000,
            value=200,
            step=10,
        )

    sql = (
        "SELECT id, name, unit_name, nutrient_nbr "
        "FROM nutrient "
        "WHERE name LIKE %s "
        "ORDER BY name "
        "LIMIT 200"
    )
    params = (f"%{nq.strip()}%",)
    _sql_box("SQL (nutrients)", sql, params)

    df, _ = _run(password, sql, params)
    if df.empty:
        st.info("No matching nutrients")
        return

    nutrient_id = st.selectbox("Choose nutrient", df["id"].tolist())
    st.dataframe(df, use_container_width=True, height=250)

    st.subheader("Foods with highest amount")
    min_amount = st.number_input("Minimum amount", min_value=0.0, value=0.0)

    sql2 = (
        "SELECT f.fdc_id, f.description, f.data_type, "
        "fn.amount, n.unit_name "
        "FROM food_nutrient fn "
        "JOIN food f ON f.fdc_id = fn.fdc_id "
        "JOIN nutrient n ON n.id = fn.nutrient_id "
        "WHERE fn.nutrient_id = %s AND fn.amount >= %s "
        "ORDER BY fn.amount DESC "
        "LIMIT %s"
    )
    params2 = (int(nutrient_id), float(min_amount), int(limit))
    _sql_box("SQL (top foods)", sql2, params2)

    if st.button("Run", type="primary"):
        d2, _ = _run(password, sql2, params2)
        st.dataframe(d2, use_container_width=True, height=520)


def page_branded_lookup(password: str):
    st.header("Branded Food Lookup")

    c1, c2, c3 = st.columns(3)
    with c1:
        upc = st.text_input("GTIN/UPC", value="")
    with c2:
        brand_owner = st.text_input("Brand owner contains", value="")
    with c3:
        ingredient = st.text_input("Ingredients contains", value="")

    limit = st.number_input(
        "Limit",
        min_value=10,
        max_value=5000,
        value=200,
        step=10,
    )

    where = []
    params: list[Any] = []

    if upc.strip():
        where.append("b.gtin_upc = %s")
        params.append(upc.strip())
    if brand_owner.strip():
        where.append("b.brand_owner LIKE %s")
        params.append(f"%{brand_owner.strip()}%")
    if ingredient.strip():
        where.append("b.ingredients LIKE %s")
        params.append(f"%{ingredient.strip()}%")

    where_sql = " AND ".join(where) if where else "1=1"

    sql = (
        "SELECT f.fdc_id, f.description, b.brand_owner, "
        "b.brand_name, b.gtin_upc "
        "FROM branded_food b "
        "JOIN food f ON f.fdc_id = b.fdc_id "
        f"WHERE {where_sql} "
        "ORDER BY f.fdc_id DESC "
        "LIMIT %s"
    )
    params2 = tuple(
        params + [int(limit)]
    )
    _sql_box("SQL", sql, params2)

    if st.button("Search", type="primary"):
        df, _ = _run(password, sql, params2)
        st.dataframe(df, use_container_width=True, height=520)


def page_table_browser(password: str):
    st.header("Table Browser")

    tables = _fetch_tables(password)
    if not tables:
        st.info("No tables found")
        return

    table = st.selectbox("Table", tables)
    cols = _fetch_columns(password, table)

    with st.expander("Columns", expanded=False):
        st.dataframe(cols, use_container_width=True)

    col_names = (
        cols["column_name"].tolist() if not cols.empty else []
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        filter_col = st.selectbox("Filter column", ["(none)"] + col_names)
    with c2:
        op = st.selectbox("Operator", ["=", "!=", ">", ">=", "<", "<=", "LIKE"])
    with c3:
        filter_val = st.text_input("Value", value="")

    limit = st.number_input(
        "Limit",
        min_value=10,
        max_value=5000,
        value=200,
        step=10,
    )
    offset = st.number_input(
        "Offset",
        min_value=0,
        max_value=5_000_000,
        value=0,
        step=200,
    )

    where = "1=1"
    params: list[Any] = []
    if filter_col != "(none)" and filter_val.strip():
        where = f"{filter_col} {op} %s"
        v = filter_val.strip()
        if op == "LIKE" and "%" not in v:
            v = f"%{v}%"
        params.append(v)

    order_col = st.selectbox("Order by", ["(none)"] + col_names)
    order_dir = st.selectbox("Direction", ["ASC", "DESC"], index=1)

    order_sql = ""
    if order_col != "(none)":
        order_sql = f" ORDER BY {order_col} {order_dir}"

    sql = f"SELECT * FROM {table} WHERE {where}{order_sql} LIMIT %s OFFSET %s"
    params2 = tuple(params + [int(limit), int(offset)])

    _sql_box("SQL", sql, params2)

    if st.button("Run", type="primary"):
        df, _ = _run(password, sql, params2)
        st.dataframe(df, use_container_width=True, height=560)


def page_crud(password: str):
    st.header("CRUD Editor")

    st.warning(
        "Writes are off by default. Use the sidebar to enable writes and "
        "type ENABLE to confirm."
    )

    tables = _fetch_tables(password)
    table = st.selectbox("Table", tables)
    cols = _fetch_columns(password, table)
    pk_cols = _fetch_primary_key_columns(password, table)

    with st.expander("Primary key", expanded=False):
        st.write({"pk_columns": pk_cols})

    mode = st.radio(
        "Mode",
        ["View", "Insert", "Update", "Delete"],
        horizontal=True,
    )

    col_meta = {
        r["column_name"]: r
        for _, r in cols.iterrows()
    }

    if mode == "View":
        st.subheader("Preview")
        sql = f"SELECT * FROM {table} LIMIT 200"
        _sql_box("SQL", sql, None)
        df, _ = _run(password, sql)
        st.dataframe(df, use_container_width=True, height=560)
        return

    if mode in {"Update", "Delete"} and not pk_cols:
        st.error("This table has no primary key; update/delete are disabled.")
        return

    if mode in {"Update", "Delete"}:
        st.subheader("Select row by primary key")
        pk_values: dict[str, Any] = {}
        for c in pk_cols:
            r = col_meta.get(c)
            dt = str(r["data_type"]) if r is not None else "varchar"
            pk_values[c] = st.text_input(f"{c}", value="")

        if st.button("Load row"):
            where = " AND ".join([f"{c} = %s" for c in pk_cols])
            params = tuple(pk_values[c] for c in pk_cols)
            sql = f"SELECT * FROM {table} WHERE {where} LIMIT 1"
            _sql_box("SQL", sql, params)
            df, _ = _run(password, sql, params)
            if df.empty:
                st.error("No row found")
            else:
                st.session_state._loaded_row = df.iloc[0].to_dict()
                st.success("Row loaded")

        loaded = st.session_state.get("_loaded_row")
        if loaded:
            st.dataframe(pd.DataFrame([loaded]), use_container_width=True)

    if mode == "Insert":
        _require_write_enabled()
        st.subheader("Insert")
        values: dict[str, Any] = {}
        for c in cols["column_name"].tolist():
            r = col_meta[c]
            dt = str(r["data_type"])
            nullable = str(r["is_nullable"]).upper() == "YES"
            default = r["column_default"]
            values[c] = _render_value_input(
                c,
                dt,
                nullable,
                default,
                None,
                key=f"ins_{table}_{c}",
            )

        if st.button("Insert row", type="primary"):
            col_list = ", ".join(values.keys())
            placeholders = ", ".join(["%s"] * len(values))
            sql = (
                f"INSERT INTO {table} ({col_list}) "
                f"VALUES ({placeholders})"
            )
            params = tuple(values.values())
            _sql_box("SQL", sql, params)
            _, rc = _run(password, sql, params, fetch=False, commit=True)
            st.success(f"Inserted. rowcount={rc}")

    if mode == "Update":
        _require_write_enabled()
        loaded = st.session_state.get("_loaded_row")
        if not loaded:
            st.info("Load a row first")
            return

        st.subheader("Update")
        updates: dict[str, Any] = {}
        for c in cols["column_name"].tolist():
            if c in pk_cols:
                continue
            r = col_meta[c]
            dt = str(r["data_type"])
            nullable = str(r["is_nullable"]).upper() == "YES"
            default = r["column_default"]
            updates[c] = _render_value_input(
                c,
                dt,
                nullable,
                default,
                loaded.get(c),
                key=f"upd_{table}_{c}",
            )

        if st.button("Update row", type="primary"):
            set_sql = ", ".join([f"{c} = %s" for c in updates.keys()])
            where_sql = " AND ".join([f"{c} = %s" for c in pk_cols])
            sql = (
                f"UPDATE {table} SET {set_sql} "
                f"WHERE {where_sql}"
            )
            pk_params = tuple(
                loaded[c] for c in pk_cols
            )
            params = tuple(updates.values()) + pk_params
            _sql_box("SQL", sql, params)
            _, rc = _run(password, sql, params, fetch=False, commit=True)
            st.success(f"Updated. rowcount={rc}")

    if mode == "Delete":
        _require_write_enabled()
        loaded = st.session_state.get("_loaded_row")
        if not loaded:
            st.info("Load a row first")
            return

        st.subheader("Delete")
        st.error("This cannot be undone")
        if st.button("Delete row", type="primary"):
            where_sql = " AND ".join([f"{c} = %s" for c in pk_cols])
            sql = (
                f"DELETE FROM {table} "
                f"WHERE {where_sql}"
            )
            params = tuple(loaded[c] for c in pk_cols)
            _sql_box("SQL", sql, params)
            _, rc = _run(password, sql, params, fetch=False, commit=True)
            st.success(f"Deleted. rowcount={rc}")
            st.session_state._loaded_row = None


def page_sql_console(password: str):
    st.header("SQL Console")

    st.caption(
        "All queries executed by the app are logged below in SQL History."
    )

    sql = st.text_area(
        "SQL",
        value=(
            "SELECT fdc_id, description FROM food "
            "ORDER BY fdc_id DESC LIMIT 50"
        ),
        height=160,
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        explain = st.checkbox("EXPLAIN (SELECT only)", value=False)
    with c2:
        fetch = st.checkbox("Fetch results", value=True)
    with c3:
        commit = st.checkbox("Commit", value=False)

    final_sql = sql
    if explain and sql.strip().lower().startswith("select"):
        final_sql = "EXPLAIN " + sql.strip()

    if st.button("Run", type="primary"):
        if _is_write_sql(final_sql):
            _require_write_enabled()
        df, rc = _run(password, final_sql, None, fetch=fetch, commit=commit)
        if fetch and not df.empty:
            st.dataframe(df, use_container_width=True, height=560)
        else:
            st.write({"rowcount": rc})

    st.subheader("SQL History")
    events = st.session_state.sql_history
    if not events:
        st.info("No history yet")
        return

    hist_df = pd.DataFrame(
        [
            {
                "ts": e.ts.strftime("%H:%M:%S"),
                "elapsed_ms": e.elapsed_ms,
                "rowcount": e.rowcount,
                "error": e.error,
                "sql": e.sql,
                "params": None if e.params is None else str(e.params),
            }
            for e in events
        ]
    )
    st.dataframe(hist_df, use_container_width=True, height=360)


def render_sidebar():
    st.sidebar.title("USDA App")

    st.sidebar.subheader("Connection")

    p = st.session_state.conn_params
    p["host"] = st.sidebar.text_input("Host", value=p["host"])
    p["port"] = st.sidebar.number_input("Port", value=int(p["port"]), step=1)
    p["user"] = st.sidebar.text_input("User", value=p["user"])
    p["database"] = st.sidebar.text_input("Database", value=p["database"])

    password_input = st.sidebar.text_input(
        "Password",
        value="",
        type="password",
    )
    password = password_input or st.session_state.db_password

    c1, c2 = st.sidebar.columns(2)
    with c1:
        if st.button("Connect"):
            try:
                _close_connection()
                _get_connection(password_input)
                st.session_state.connected = True
                st.session_state.db_password = password_input
                st.sidebar.success("Connected")
            except Exception as e:
                st.session_state.connected = False
                st.sidebar.error(str(e))

    with c2:
        if st.button("Disconnect"):
            _close_connection()
            st.sidebar.info("Disconnected")

    st.sidebar.subheader("Writes")
    st.session_state.write_enabled = st.sidebar.checkbox(
        "Enable writes",
        value=st.session_state.write_enabled,
    )
    st.session_state.write_confirm = st.sidebar.text_input(
        "Type ENABLE to confirm",
        value=st.session_state.write_confirm,
    )
    if st.session_state.write_confirm.strip().upper() != "ENABLE":
        st.session_state.write_enabled = False

    st.sidebar.subheader("Navigation")
    page = st.sidebar.radio(
        "Page",
        [
            "Home",
            "Food Search",
            "Nutrient Explorer",
            "Branded Lookup",
            "Table Browser",
            "CRUD",
            "SQL Console",
        ],
    )

    st.sidebar.subheader("SQL")
    st.sidebar.write(f"History: {len(st.session_state.sql_history)}")

    return password, page


def _inject_css():
    css = """
    <style>
    .stApp {
      background: linear-gradient(
        180deg,
        #0b1220 0%,
        #0b1324 35%,
        #0e1a33 100%
      );
    }
    section[data-testid="stSidebar"] { background: #0a1020; }
    div[data-testid="stMetric"] {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      padding: 10px;
      border-radius: 12px;
    }
    div[data-testid="stDataFrame"] { border-radius: 12px; overflow: hidden; }
    </style>
    """
    st.markdown(css, unsafe_allow_html=True)


def main():
    st.set_page_config(
        page_title="USDA App",
        page_icon="🍎",
        layout="wide",
    )

    _init_state()
    _inject_css()

    password, page = render_sidebar()

    if not st.session_state.connected:
        st.info("Connect to the database using the sidebar.")
        st.stop()

    if page == "Home":
        page_home(password)
    elif page == "Food Search":
        page_food_search(password)
    elif page == "Nutrient Explorer":
        page_nutrient_explorer(password)
    elif page == "Branded Lookup":
        page_branded_lookup(password)
    elif page == "Table Browser":
        page_table_browser(password)
    elif page == "CRUD":
        page_crud(password)
    elif page == "SQL Console":
        page_sql_console(password)


if __name__ == "__main__":
    main()
