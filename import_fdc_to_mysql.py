import argparse
import os
from pathlib import Path
import threading
import traceback
from dataclasses import dataclass
from typing import Callable, Optional

import mysql.connector
from mysql.connector.constants import ClientFlag


class ImportCancelled(Exception):
    pass


@dataclass
class ImportOptions:
    dataset_dir: Path
    host: str
    port: int
    user: str
    password: str
    database: str
    create_tables: bool = True
    truncate: bool = False
    load_data: bool = True
    create_indexes: bool = True


@dataclass
class ImportCallbacks:
    log: Optional[Callable[[str, str], None]] = None
    progress: Optional[Callable[[int, int, str], None]] = None
    status: Optional[Callable[[str], None]] = None
    table_loaded: Optional[Callable[[str, int], None]] = None


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


def _sql_file_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "''")


def get_table_csv_path(dataset_dir: Path, table: str) -> Path:
    return dataset_dir / f"{table}.csv"


def _connect(args: argparse.Namespace):
    return mysql.connector.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
        allow_local_infile=True,
        client_flags=[ClientFlag.LOCAL_FILES],
        autocommit=False,
    )


def _get_local_infile_state(cursor) -> Optional[int]:
    try:
        cursor.execute("SELECT @@local_infile")
        row = cursor.fetchone()
        if row is None:
            return None
        return int(row[0])
    except Exception:
        return None


def _ensure_local_infile_enabled(cursor):
    state = _get_local_infile_state(cursor)
    if state == 1:
        return
    raise RuntimeError(
        "MySQL rejected LOAD DATA LOCAL INFILE. "
        "The server variable local_infile is disabled or restricted. "
        "Enable it on the MySQL server and allow it for this connection. "
        "On the server, confirm: SELECT @@local_infile; (must be 1). "
        "If you administer the server, set local_infile=1 and restart, "
        "or run SET GLOBAL local_infile=1 (if permitted)."
    )


def _connect_options(options: ImportOptions):
    return mysql.connector.connect(
        host=options.host,
        port=options.port,
        user=options.user,
        password=options.password,
        database=options.database,
        allow_local_infile=True,
        client_flags=[ClientFlag.LOCAL_FILES],
        autocommit=False,
    )


def _execute(cursor, statements: list[str]):
    for stmt in statements:
        cursor.execute(stmt)


def schema_statements() -> list[str]:
    return [
        "SET SESSION foreign_key_checks = 0",
        "SET SESSION unique_checks = 0",
        "SET SESSION sql_mode = ''",
        "CREATE TABLE IF NOT EXISTS nutrient (\n"
        "  id INT NOT NULL,\n"
        "  name VARCHAR(255) NULL,\n"
        "  unit_name VARCHAR(50) NULL,\n"
        "  nutrient_nbr VARCHAR(20) NULL,\n"
        "  `rank` DECIMAL(12,3) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_category (\n"
        "  id INT NOT NULL,\n"
        "  code VARCHAR(10) NULL,\n"
        "  description VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS measure_unit (\n"
        "  id INT NOT NULL,\n"
        "  name VARCHAR(100) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_attribute_type (\n"
        "  id INT NOT NULL,\n"
        "  name VARCHAR(100) NULL,\n"
        "  description VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_nutrient_derivation (\n"
        "  id INT NOT NULL,\n"
        "  code VARCHAR(10) NULL,\n"
        "  description VARCHAR(500) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_nutrient_source (\n"
        "  id INT NOT NULL,\n"
        "  code VARCHAR(10) NULL,\n"
        "  description VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS lab_method (\n"
        "  id INT NOT NULL,\n"
        "  description VARCHAR(255) NULL,\n"
        "  technique VARCHAR(100) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS lab_method_code (\n"
        "  lab_method_id INT NOT NULL,\n"
        "  code VARCHAR(64) NOT NULL,\n"
        "  PRIMARY KEY (lab_method_id, code)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS lab_method_nutrient (\n"
        "  lab_method_id INT NOT NULL,\n"
        "  nutrient_id INT NOT NULL,\n"
        "  PRIMARY KEY (lab_method_id, nutrient_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS wweia_food_category (\n"
        "  wweia_food_category INT NOT NULL,\n"
        "  wweia_food_category_description VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (wweia_food_category)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS retention_factor (\n"
        "  gid INT NOT NULL,\n"
        "  code INT NULL,\n"
        "  food_group_id INT NULL,\n"
        "  description VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (gid)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_update_log_entry (\n"
        "  id BIGINT NOT NULL,\n"
        "  description TEXT NULL,\n"
        "  last_updated DATE NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  data_type VARCHAR(50) NULL,\n"
        "  description TEXT NULL,\n"
        "  food_category_id INT NULL,\n"
        "  food_category VARCHAR(255) NULL,\n"
        "  publication_date DATE NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS branded_food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  brand_owner VARCHAR(255) NULL,\n"
        "  brand_name VARCHAR(255) NULL,\n"
        "  subbrand_name VARCHAR(255) NULL,\n"
        "  gtin_upc VARCHAR(32) NULL,\n"
        "  ingredients LONGTEXT NULL,\n"
        "  not_a_significant_source_of TEXT NULL,\n"
        "  serving_size DECIMAL(18,6) NULL,\n"
        "  serving_size_unit VARCHAR(64) NULL,\n"
        "  household_serving_fulltext VARCHAR(255) NULL,\n"
        "  branded_food_category VARCHAR(255) NULL,\n"
        "  data_source VARCHAR(64) NULL,\n"
        "  package_weight VARCHAR(64) NULL,\n"
        "  modified_date DATE NULL,\n"
        "  available_date DATE NULL,\n"
        "  market_country VARCHAR(64) NULL,\n"
        "  discontinued_date DATE NULL,\n"
        "  preparation_state_code VARCHAR(32) NULL,\n"
        "  trade_channel VARCHAR(64) NULL,\n"
        "  short_description VARCHAR(255) NULL,\n"
        "  material_code VARCHAR(64) NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS foundation_food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  ndb_number VARCHAR(32) NULL,\n"
        "  footnote TEXT NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS sr_legacy_food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  ndb_number VARCHAR(32) NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS survey_fndds_food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  food_code VARCHAR(32) NULL,\n"
        "  wweia_category_code INT NULL,\n"
        "  start_date DATE NULL,\n"
        "  end_date DATE NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_nutrient (\n"
        "  id BIGINT NOT NULL,\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  nutrient_id INT NOT NULL,\n"
        "  amount DECIMAL(18,6) NULL,\n"
        "  data_points INT NULL,\n"
        "  derivation_id INT NULL,\n"
        "  min DECIMAL(18,6) NULL,\n"
        "  max DECIMAL(18,6) NULL,\n"
        "  median DECIMAL(18,6) NULL,\n"
        "  loq DECIMAL(18,6) NULL,\n"
        "  footnote TEXT NULL,\n"
        "  min_year_acquired INT NULL,\n"
        "  percent_daily_value DECIMAL(18,6) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS sub_sample_result (\n"
        "  id BIGINT NOT NULL AUTO_INCREMENT,\n"
        "  food_nutrient_id BIGINT NOT NULL,\n"
        "  adjusted_amount DECIMAL(18,6) NULL,\n"
        "  lab_method_id INT NULL,\n"
        "  nutrient_name VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (id),\n"
        "  UNIQUE KEY uq_sub_sample_result_food_lab "
        "(food_nutrient_id, lab_method_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_portion (\n"
        "  id BIGINT NOT NULL,\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  seq_num INT NULL,\n"
        "  amount DECIMAL(18,6) NULL,\n"
        "  measure_unit_id INT NULL,\n"
        "  portion_description VARCHAR(255) NULL,\n"
        "  modifier VARCHAR(255) NULL,\n"
        "  gram_weight DECIMAL(18,6) NULL,\n"
        "  data_points INT NULL,\n"
        "  footnote TEXT NULL,\n"
        "  min_year_acquired INT NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_attribute (\n"
        "  id BIGINT NOT NULL,\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  seq_num INT NULL,\n"
        "  food_attribute_type_id INT NULL,\n"
        "  name VARCHAR(255) NULL,\n"
        "  value TEXT NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_component (\n"
        "  id BIGINT NOT NULL,\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  name VARCHAR(255) NULL,\n"
        "  pct_weight DECIMAL(10,3) NULL,\n"
        "  is_refuse CHAR(1) NULL,\n"
        "  gram_weight DECIMAL(18,6) NULL,\n"
        "  data_points INT NULL,\n"
        "  min_year_acquired INT NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_nutrient_conversion_factor (\n"
        "  id BIGINT NOT NULL,\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_calorie_conversion_factor (\n"
        "  food_nutrient_conversion_factor_id BIGINT NOT NULL,\n"
        "  protein_value DECIMAL(10,3) NULL,\n"
        "  fat_value DECIMAL(10,3) NULL,\n"
        "  carbohydrate_value DECIMAL(10,3) NULL,\n"
        "  PRIMARY KEY (food_nutrient_conversion_factor_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS food_protein_conversion_factor (\n"
        "  food_nutrient_conversion_factor_id BIGINT NOT NULL,\n"
        "  value DECIMAL(10,3) NULL,\n"
        "  PRIMARY KEY (food_nutrient_conversion_factor_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS input_food (\n"
        "  id BIGINT NOT NULL,\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  fdc_id_of_input_food BIGINT NULL,\n"
        "  seq_num INT NULL,\n"
        "  amount DECIMAL(18,6) NULL,\n"
        "  sr_code VARCHAR(32) NULL,\n"
        "  sr_description TEXT NULL,\n"
        "  unit VARCHAR(32) NULL,\n"
        "  portion_code VARCHAR(32) NULL,\n"
        "  portion_description VARCHAR(255) NULL,\n"
        "  gram_weight DECIMAL(18,6) NULL,\n"
        "  retention_code VARCHAR(32) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS sample_food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS sub_sample_food (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  fdc_id_of_sample_food BIGINT NOT NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS market_acquisition (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  brand_description VARCHAR(255) NULL,\n"
        "  expiration_date DATE NULL,\n"
        "  label_weight VARCHAR(64) NULL,\n"
        "  location VARCHAR(64) NULL,\n"
        "  acquisition_date DATE NULL,\n"
        "  sales_type VARCHAR(64) NULL,\n"
        "  sample_lot_nbr VARCHAR(64) NULL,\n"
        "  sell_by_date DATE NULL,\n"
        "  store_city VARCHAR(128) NULL,\n"
        "  store_name VARCHAR(255) NULL,\n"
        "  store_state VARCHAR(32) NULL,\n"
        "  upc_code VARCHAR(64) NULL,\n"
        "  acquisition_number VARCHAR(64) NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS acquisition_samples (\n"
        "  fdc_id_of_sample_food BIGINT NOT NULL,\n"
        "  fdc_id_of_acquisition_food BIGINT NOT NULL,\n"
        "  PRIMARY KEY (fdc_id_of_sample_food, fdc_id_of_acquisition_food)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS agricultural_samples (\n"
        "  fdc_id BIGINT NOT NULL,\n"
        "  acquisition_date DATE NULL,\n"
        "  market_class VARCHAR(128) NULL,\n"
        "  treatment VARCHAR(128) NULL,\n"
        "  state VARCHAR(16) NULL,\n"
        "  PRIMARY KEY (fdc_id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS microbe (\n"
        "  id INT NOT NULL,\n"
        "  fdc_id BIGINT NULL,\n"
        "  method VARCHAR(64) NULL,\n"
        "  microbe_code VARCHAR(128) NULL,\n"
        "  min_value BIGINT NULL,\n"
        "  max_value BIGINT NULL,\n"
        "  uom VARCHAR(32) NULL,\n"
        "  PRIMARY KEY (id)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS fndds_derivation (\n"
        "  derivation_code VARCHAR(16) NOT NULL,\n"
        "  derivation_description VARCHAR(255) NULL,\n"
        "  PRIMARY KEY (derivation_code)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS fndds_ingredient_nutrient_value (\n"
        "  ingredient_code INT NULL,\n"
        "  ingredient_description VARCHAR(255) NULL,\n"
        "  nutrient_code INT NULL,\n"
        "  nutrient_value DECIMAL(18,6) NULL,\n"
        "  nutrient_value_source VARCHAR(64) NULL,\n"
        "  fdc_id BIGINT NULL,\n"
        "  derivation_code VARCHAR(16) NULL,\n"
        "  sr_addmod_year INT NULL,\n"
        "  foundation_year_acquired INT NULL,\n"
        "  start_date DATE NULL,\n"
        "  end_date DATE NULL\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "SET SESSION foreign_key_checks = 1",
        "SET SESSION unique_checks = 1",
    ]


def _create_tables(cursor):
    _execute(cursor, schema_statements())


def _truncate_tables(cursor):
    tables = [
        "fndds_ingredient_nutrient_value",
        "fndds_derivation",
        "microbe",
        "agricultural_samples",
        "acquisition_samples",
        "market_acquisition",
        "sub_sample_food",
        "sample_food",
        "input_food",
        "food_protein_conversion_factor",
        "food_calorie_conversion_factor",
        "food_nutrient_conversion_factor",
        "food_component",
        "food_attribute",
        "food_portion",
        "sub_sample_result",
        "food_nutrient",
        "survey_fndds_food",
        "sr_legacy_food",
        "foundation_food",
        "branded_food",
        "food",
        "food_update_log_entry",
        "retention_factor",
        "wweia_food_category",
        "lab_method_nutrient",
        "lab_method_code",
        "lab_method",
        "food_nutrient_source",
        "food_nutrient_derivation",
        "food_attribute_type",
        "measure_unit",
        "food_category",
        "nutrient",
    ]
    cursor.execute("SET SESSION foreign_key_checks = 0")
    for t in tables:
        cursor.execute(f"TRUNCATE TABLE {t}")
    cursor.execute("SET SESSION foreign_key_checks = 1")


def _load(cursor, table: str, file_path: Path, load_sql: str) -> int:
    if not file_path.exists():
        raise FileNotFoundError(str(file_path))
    sql = load_sql.format(file=_sql_file_path(file_path))
    cursor.execute(sql)
    try:
        cursor.execute("SELECT ROW_COUNT()")
        row = cursor.fetchone()
        if row is None:
            return int(cursor.rowcount)
        return int(row[0])
    except Exception:
        return -1


def _maybe_cancel(cancel_event: Optional[threading.Event]):
    if cancel_event is not None and cancel_event.is_set():
        raise ImportCancelled("Import cancelled")


def _load_all(
    cursor,
    dataset_dir: Path,
    callbacks: Optional[ImportCallbacks] = None,
    cancel_event: Optional[threading.Event] = None,
    step_offset: int = 0,
    total_steps: Optional[int] = None,
):
    loads: list[tuple[str, str]] = [
        (
            "nutrient",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE nutrient "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@name,@unit_name,@nutrient_nbr,@rank) "
            "SET id=@id+0, name=NULLIF(@name,''), unit_name=NULLIF(@unit_name,''), "
            "nutrient_nbr=NULLIF(@nutrient_nbr,''), `rank`=NULLIF(@rank,'')+0",
        ),
        (
            "food_category",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_category "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@code,@description) "
            "SET id=@id+0, code=NULLIF(@code,''), description=NULLIF(@description,'')",
        ),
        (
            "measure_unit",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE measure_unit "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@name) "
            "SET id=@id+0, name=NULLIF(@name,'')",
        ),
        (
            "food_attribute_type",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_attribute_type "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@name,@description) "
            "SET id=@id+0, name=NULLIF(@name,''), description=NULLIF(@description,'')",
        ),
        (
            "food_nutrient_derivation",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_nutrient_derivation "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@code,@description) "
            "SET id=@id+0, code=NULLIF(@code,''), description=NULLIF(@description,'')",
        ),
        (
            "food_nutrient_source",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_nutrient_source "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@code,@description) "
            "SET id=@id+0, code=NULLIF(@code,''), description=NULLIF(@description,'')",
        ),
        (
            "lab_method",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE lab_method "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@description,@technique) "
            "SET id=@id+0, description=NULLIF(@description,''), technique=NULLIF(@technique,'')",
        ),
        (
            "lab_method_code",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE lab_method_code "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@lab_method_id,@code) "
            "SET lab_method_id=@lab_method_id+0, code=NULLIF(@code,'')",
        ),
        (
            "lab_method_nutrient",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE lab_method_nutrient "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@lab_method_id,@nutrient_id) "
            "SET lab_method_id=@lab_method_id+0, nutrient_id=@nutrient_id+0",
        ),
        (
            "wweia_food_category",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE wweia_food_category "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@code,@desc) "
            "SET wweia_food_category=@code+0, wweia_food_category_description=NULLIF(@desc,'')",
        ),
        (
            "retention_factor",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE retention_factor "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@gid,@code,@fgid,@desc) "
            "SET gid=@gid+0, code=NULLIF(@code,'')+0, food_group_id=NULLIF(@fgid,'')+0, description=NULLIF(@desc,'')",
        ),
        (
            "food_update_log_entry",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_update_log_entry "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@description,@last_updated) "
            "SET id=@id+0, description=NULLIF(@description,''), last_updated=STR_TO_DATE(NULLIF(@last_updated,''), '%Y-%m-%d')",
        ),
        (
            "food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@data_type,@description,@food_category_raw,@publication_date) "
            "SET fdc_id=@fdc_id+0, data_type=NULLIF(@data_type,''), description=NULLIF(@description,''), "
            "food_category_id=IF(@food_category_raw REGEXP '^[0-9]+$', @food_category_raw+0, NULL), "
            "food_category=IF(@food_category_raw REGEXP '^[0-9]+$', NULL, NULLIF(@food_category_raw,'')), "
            "publication_date=STR_TO_DATE(NULLIF(@publication_date,''), '%Y-%m-%d')",
        ),
        (
            "branded_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE branded_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@brand_owner,@brand_name,@subbrand_name,@gtin_upc,@ingredients,"
            "@not_sig,@serving_size,@serving_size_unit,@household_serving_fulltext,@branded_food_category,"
            "@data_source,@package_weight,@modified_date,@available_date,@market_country,@discontinued_date,"
            "@preparation_state_code,@trade_channel,@short_description,@material_code) "
            "SET fdc_id=@fdc_id+0, brand_owner=NULLIF(@brand_owner,''), brand_name=NULLIF(@brand_name,''), "
            "subbrand_name=NULLIF(@subbrand_name,''), gtin_upc=NULLIF(@gtin_upc,''), ingredients=NULLIF(@ingredients,''), "
            "not_a_significant_source_of=NULLIF(@not_sig,''), serving_size=NULLIF(@serving_size,'')+0, "
            "serving_size_unit=NULLIF(@serving_size_unit,''), household_serving_fulltext=NULLIF(@household_serving_fulltext,''), "
            "branded_food_category=NULLIF(@branded_food_category,''), data_source=NULLIF(@data_source,''), package_weight=NULLIF(@package_weight,''), "
            "modified_date=STR_TO_DATE(NULLIF(@modified_date,''), '%Y-%m-%d'), available_date=STR_TO_DATE(NULLIF(@available_date,''), '%Y-%m-%d'), "
            "market_country=NULLIF(@market_country,''), discontinued_date=STR_TO_DATE(NULLIF(@discontinued_date,''), '%Y-%m-%d'), "
            "preparation_state_code=NULLIF(@preparation_state_code,''), trade_channel=NULLIF(@trade_channel,''), "
            "short_description=NULLIF(@short_description,''), material_code=NULLIF(@material_code,'')",
        ),
        (
            "foundation_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE foundation_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@ndb_number,@footnote) "
            "SET fdc_id=@fdc_id+0, ndb_number=NULLIF(@ndb_number,''), footnote=NULLIF(@footnote,'')",
        ),
        (
            "sr_legacy_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE sr_legacy_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@ndb_number) "
            "SET fdc_id=@fdc_id+0, ndb_number=NULLIF(@ndb_number,'')",
        ),
        (
            "survey_fndds_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE survey_fndds_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@food_code,@wweia_category_code,@start_date,@end_date) "
            "SET fdc_id=@fdc_id+0, food_code=NULLIF(@food_code,''), wweia_category_code=NULLIF(@wweia_category_code,'')+0, "
            "start_date=STR_TO_DATE(NULLIF(@start_date,''), '%Y-%m-%d'), end_date=STR_TO_DATE(NULLIF(@end_date,''), '%Y-%m-%d')",
        ),
        (
            "food_nutrient_conversion_factor",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_nutrient_conversion_factor "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@fdc_id) "
            "SET id=@id+0, fdc_id=@fdc_id+0",
        ),
        (
            "food_calorie_conversion_factor",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_calorie_conversion_factor "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@protein_value,@fat_value,@carb_value) "
            "SET food_nutrient_conversion_factor_id=@id+0, protein_value=NULLIF(@protein_value,'')+0, fat_value=NULLIF(@fat_value,'')+0, carbohydrate_value=NULLIF(@carb_value,'')+0",
        ),
        (
            "food_protein_conversion_factor",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_protein_conversion_factor "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@value) "
            "SET food_nutrient_conversion_factor_id=@id+0, value=NULLIF(@value,'')+0",
        ),
        (
            "food_nutrient",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_nutrient "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@fdc_id,@nutrient_id,@amount,@data_points,@derivation_id,@min,@max,@median,@loq,@footnote,@min_year_acquired,@percent_daily_value) "
            "SET id=@id+0, fdc_id=@fdc_id+0, nutrient_id=@nutrient_id+0, amount=NULLIF(@amount,'')+0, data_points=NULLIF(@data_points,'')+0, "
            "derivation_id=NULLIF(@derivation_id,'')+0, min=NULLIF(@min,'')+0, max=NULLIF(@max,'')+0, median=NULLIF(@median,'')+0, loq=NULLIF(@loq,'')+0, "
            "footnote=NULLIF(@footnote,''), min_year_acquired=NULLIF(@min_year_acquired,'')+0, percent_daily_value=NULLIF(@percent_daily_value,'')+0",
        ),
        (
            "sub_sample_result",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE sub_sample_result "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@food_nutrient_id,@adjusted_amount,@lab_method_id,@nutrient_name) "
            "SET food_nutrient_id=@food_nutrient_id+0, adjusted_amount=NULLIF(@adjusted_amount,'')+0, lab_method_id=NULLIF(@lab_method_id,'')+0, nutrient_name=NULLIF(@nutrient_name,'')",
        ),
        (
            "food_portion",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_portion "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@fdc_id,@seq_num,@amount,@measure_unit_id,@portion_description,@modifier,@gram_weight,@data_points,@footnote,@min_year_acquired) "
            "SET id=@id+0, fdc_id=@fdc_id+0, seq_num=NULLIF(@seq_num,'')+0, amount=NULLIF(@amount,'')+0, measure_unit_id=NULLIF(@measure_unit_id,'')+0, "
            "portion_description=NULLIF(@portion_description,''), modifier=NULLIF(@modifier,''), gram_weight=NULLIF(@gram_weight,'')+0, data_points=NULLIF(@data_points,'')+0, footnote=NULLIF(@footnote,''), "
            "min_year_acquired=NULLIF(@min_year_acquired,'')+0",
        ),
        (
            "food_attribute",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_attribute "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@fdc_id,@seq_num,@food_attribute_type_id,@name,@value) "
            "SET id=@id+0, fdc_id=@fdc_id+0, seq_num=NULLIF(@seq_num,'')+0, food_attribute_type_id=NULLIF(@food_attribute_type_id,'')+0, "
            "name=NULLIF(@name,''), value=NULLIF(@value,'')",
        ),
        (
            "food_component",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE food_component "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@fdc_id,@name,@pct_weight,@is_refuse,@gram_weight,@data_points,@min_year_acquired) "
            "SET id=@id+0, fdc_id=@fdc_id+0, name=NULLIF(@name,''), pct_weight=NULLIF(@pct_weight,'')+0, is_refuse=NULLIF(@is_refuse,''), "
            "gram_weight=NULLIF(@gram_weight,'')+0, data_points=NULLIF(@data_points,'')+0, min_year_acquired=NULLIF(@min_year_acquired,'')+0",
        ),
        (
            "input_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE input_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@fdc_id,@fdc_id_of_input_food,@seq_num,@amount,@sr_code,@sr_description,@unit,@portion_code,@portion_description,@gram_weight,@retention_code) "
            "SET id=@id+0, fdc_id=@fdc_id+0, fdc_id_of_input_food=NULLIF(@fdc_id_of_input_food,'')+0, seq_num=NULLIF(@seq_num,'')+0, amount=NULLIF(@amount,'')+0, "
            "sr_code=NULLIF(@sr_code,''), sr_description=NULLIF(@sr_description,''), unit=NULLIF(@unit,''), portion_code=NULLIF(@portion_code,''), portion_description=NULLIF(@portion_description,''), "
            "gram_weight=NULLIF(@gram_weight,'')+0, retention_code=NULLIF(@retention_code,'')",
        ),
        (
            "sample_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE sample_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id) SET fdc_id=@fdc_id+0",
        ),
        (
            "sub_sample_food",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE sub_sample_food "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@fdc_id_of_sample_food) "
            "SET fdc_id=@fdc_id+0, fdc_id_of_sample_food=@fdc_id_of_sample_food+0",
        ),
        (
            "market_acquisition",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE market_acquisition "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@brand_description,@expiration_date,@label_weight,@location,@acquisition_date,@sales_type,@sample_lot_nbr,@sell_by_date,@store_city,@store_name,@store_state,@upc_code,@acquisition_number) "
            "SET fdc_id=@fdc_id+0, brand_description=NULLIF(@brand_description,''), expiration_date=STR_TO_DATE(NULLIF(@expiration_date,''), '%Y-%m-%d'), "
            "label_weight=NULLIF(@label_weight,''), location=NULLIF(@location,''), acquisition_date=STR_TO_DATE(NULLIF(@acquisition_date,''), '%Y-%m-%d'), sales_type=NULLIF(@sales_type,''), "
            "sample_lot_nbr=NULLIF(@sample_lot_nbr,''), sell_by_date=STR_TO_DATE(NULLIF(@sell_by_date,''), '%Y-%m-%d'), store_city=NULLIF(@store_city,''), store_name=NULLIF(@store_name,''), "
            "store_state=NULLIF(@store_state,''), upc_code=NULLIF(@upc_code,''), acquisition_number=NULLIF(@acquisition_number,'')",
        ),
        (
            "acquisition_samples",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE acquisition_samples "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@sample,@acq) SET fdc_id_of_sample_food=@sample+0, fdc_id_of_acquisition_food=@acq+0",
        ),
        (
            "agricultural_samples",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE agricultural_samples "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@fdc_id,@acq_date,@market_class,@treatment,@state) "
            "SET fdc_id=@fdc_id+0, acquisition_date=STR_TO_DATE(NULLIF(@acq_date,''), '%Y-%m-%d'), market_class=NULLIF(@market_class,''), treatment=NULLIF(@treatment,''), state=NULLIF(@state,'')",
        ),
        (
            "microbe",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE microbe "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@id,@foodId,@method,@microbe_code,@min_value,@max_value,@uom) "
            "SET id=@id+0, fdc_id=NULLIF(@foodId,'')+0, method=NULLIF(@method,''), microbe_code=NULLIF(@microbe_code,''), "
            "min_value=NULLIF(@min_value,'')+0, max_value=NULLIF(@max_value,'')+0, uom=NULLIF(@uom,'')",
        ),
        (
            "fndds_derivation",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE fndds_derivation "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@code,@desc) "
            "SET derivation_code=NULLIF(@code,''), derivation_description=NULLIF(@desc,'')",
        ),
        (
            "fndds_ingredient_nutrient_value",
            "LOAD DATA LOCAL INFILE '{file}' INTO TABLE fndds_ingredient_nutrient_value "
            "FIELDS TERMINATED BY ',' ENCLOSED BY '\"' LINES TERMINATED BY '\n' "
            "IGNORE 1 LINES "
            "(@ingredient_code,@ingredient_description,@nutrient_code,@nutrient_value,@nutrient_value_source,@fdc_id,@derivation_code,@sr_addmod_year,@foundation_year_acquired,@start_date,@end_date) "
            "SET ingredient_code=NULLIF(@ingredient_code,'')+0, ingredient_description=NULLIF(@ingredient_description,''), nutrient_code=NULLIF(@nutrient_code,'')+0, "
            "nutrient_value=NULLIF(@nutrient_value,'')+0, nutrient_value_source=NULLIF(@nutrient_value_source,''), fdc_id=NULLIF(@fdc_id,'')+0, derivation_code=NULLIF(@derivation_code,''), "
            "sr_addmod_year=NULLIF(@sr_addmod_year,'')+0, foundation_year_acquired=NULLIF(@foundation_year_acquired,'')+0, "
            "start_date=STR_TO_DATE(NULLIF(@start_date,''), '%Y-%m-%d'), end_date=STR_TO_DATE(NULLIF(@end_date,''), '%Y-%m-%d')",
        ),
    ]

    for idx, (table, sql) in enumerate(loads):
        _maybe_cancel(cancel_event)
        if callbacks is not None and callbacks.status is not None:
            callbacks.status(f"Loading {table}")
        if callbacks is not None and callbacks.log is not None:
            callbacks.log("INFO", f"Loading table {table}")
        file_path = get_table_csv_path(dataset_dir, table)
        loaded_rows = _load(cursor, table, file_path, sql)
        if callbacks is not None and callbacks.log is not None:
            if loaded_rows >= 0:
                callbacks.log(
                    "INFO",
                    f"Loaded table {table}: {loaded_rows} rows",
                )
            else:
                callbacks.log("INFO", f"Loaded table {table}")
        if callbacks is not None and callbacks.table_loaded is not None:
            callbacks.table_loaded(table, loaded_rows)
        if callbacks is not None and callbacks.progress is not None:
            current_step = step_offset + idx + 1
            callbacks.progress(
                current_step,
                total_steps if total_steps is not None else current_step,
                f"Loaded {table}",
            )


def get_load_table_order() -> list[str]:
    return [
        "nutrient",
        "food_category",
        "measure_unit",
        "food_attribute_type",
        "food_nutrient_derivation",
        "food_nutrient_source",
        "lab_method",
        "lab_method_code",
        "lab_method_nutrient",
        "wweia_food_category",
        "retention_factor",
        "food_update_log_entry",
        "food",
        "branded_food",
        "foundation_food",
        "sr_legacy_food",
        "survey_fndds_food",
        "food_nutrient_conversion_factor",
        "food_calorie_conversion_factor",
        "food_protein_conversion_factor",
        "food_nutrient",
        "sub_sample_result",
        "food_portion",
        "food_attribute",
        "food_component",
        "input_food",
        "sample_food",
        "sub_sample_food",
        "market_acquisition",
        "acquisition_samples",
        "agricultural_samples",
        "microbe",
        "fndds_derivation",
        "fndds_ingredient_nutrient_value",
    ]


def run_import(
    options: ImportOptions,
    callbacks: Optional[ImportCallbacks] = None,
    cancel_event: Optional[threading.Event] = None,
):
    def _log(level: str, msg: str):
        if callbacks is not None and callbacks.log is not None:
            callbacks.log(level, msg)

    def _status(msg: str):
        if callbacks is not None and callbacks.status is not None:
            callbacks.status(msg)

    tables = get_load_table_order() if options.load_data else []
    total_steps = 0
    if options.create_tables:
        total_steps += 1
    if options.truncate:
        total_steps += 1
    total_steps += len(tables)
    if options.create_indexes:
        total_steps += 1

    step = 0
    _status("Connecting")
    _log(
        "INFO",
        f"Connecting to {options.host}:{options.port}/{options.database}",
    )

    conn = _connect_options(options)
    try:
        cur = conn.cursor()

        if options.load_data:
            _status("Checking server settings")
            _log("INFO", "Checking LOCAL INFILE support")
            _ensure_local_infile_enabled(cur)

        if options.create_tables:
            _maybe_cancel(cancel_event)
            _status("Creating tables")
            _log("INFO", "Creating tables")
            _create_tables(cur)
            conn.commit()
            step += 1
            if callbacks is not None and callbacks.progress is not None:
                callbacks.progress(step, total_steps, "Created tables")

        if options.truncate:
            _maybe_cancel(cancel_event)
            _status("Truncating tables")
            _log("INFO", "Truncating tables")
            _truncate_tables(cur)
            conn.commit()
            step += 1
            if callbacks is not None and callbacks.progress is not None:
                callbacks.progress(step, total_steps, "Truncated tables")

        if options.load_data:
            _maybe_cancel(cancel_event)
            _status("Loading data")
            _log("INFO", "Loading data")
            _load_all(
                cur,
                options.dataset_dir,
                callbacks=callbacks,
                cancel_event=cancel_event,
                step_offset=step,
                total_steps=total_steps,
            )
            conn.commit()
            step += len(tables)

        if options.create_indexes:
            _maybe_cancel(cancel_event)
            _status("Creating indexes")
            _log("INFO", "Creating indexes")
            _create_post_load_indexes(cur)
            conn.commit()
            step += 1
            if callbacks is not None and callbacks.progress is not None:
                callbacks.progress(step, total_steps, "Created indexes")

        _status("Done")
        _log("INFO", "Import complete")
    except ImportCancelled:
        conn.rollback()
        _status("Cancelled")
        _log("WARNING", "Import cancelled")
        raise
    except Exception as e:
        conn.rollback()
        _status("Error")
        _log("ERROR", f"Import failed: {e}\n{traceback.format_exc()}")
        raise
    finally:
        conn.close()


def _index_exists(cursor, table_name: str, index_name: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM information_schema.statistics "
        "WHERE table_schema = DATABASE() "
        "AND table_name = %s "
        "AND index_name = %s "
        "LIMIT 1",
        (table_name, index_name),
    )
    return cursor.fetchone() is not None


def index_statements() -> list[tuple[str, str, str]]:
    return [
        (
            "food_nutrient",
            "idx_food_nutrient_fdc_id",
            "CREATE INDEX idx_food_nutrient_fdc_id ON food_nutrient (fdc_id)",
        ),
        (
            "food_nutrient",
            "idx_food_nutrient_nutrient_id",
            "CREATE INDEX idx_food_nutrient_nutrient_id "
            "ON food_nutrient (nutrient_id)",
        ),
        (
            "food_nutrient",
            "idx_food_nutrient_fdc_nutrient",
            "CREATE INDEX idx_food_nutrient_fdc_nutrient "
            "ON food_nutrient (fdc_id, nutrient_id)",
        ),
        (
            "food_portion",
            "idx_food_portion_fdc_id",
            "CREATE INDEX idx_food_portion_fdc_id ON food_portion (fdc_id)",
        ),
        (
            "food_attribute",
            "idx_food_attribute_fdc_id",
            "CREATE INDEX idx_food_attribute_fdc_id "
            "ON food_attribute (fdc_id)",
        ),
        (
            "food_component",
            "idx_food_component_fdc_id",
            "CREATE INDEX idx_food_component_fdc_id "
            "ON food_component (fdc_id)",
        ),
        (
            "input_food",
            "idx_input_food_fdc_id",
            "CREATE INDEX idx_input_food_fdc_id ON input_food (fdc_id)",
        ),
        (
            "survey_fndds_food",
            "idx_survey_fndds_food_wweia",
            "CREATE INDEX idx_survey_fndds_food_wweia "
            "ON survey_fndds_food (wweia_category_code)",
        ),
        (
            "food_nutrient_conversion_factor",
            "idx_food_nutrient_conversion_factor_fdc_id",
            "CREATE INDEX idx_food_nutrient_conversion_factor_fdc_id "
            "ON food_nutrient_conversion_factor (fdc_id)",
        ),
        (
            "sub_sample_food",
            "idx_sub_sample_food_sample",
            "CREATE INDEX idx_sub_sample_food_sample "
            "ON sub_sample_food (fdc_id_of_sample_food)",
        ),
        (
            "market_acquisition",
            "idx_market_acquisition_upc",
            "CREATE INDEX idx_market_acquisition_upc "
            "ON market_acquisition (upc_code)",
        ),
    ]


def _create_post_load_indexes(cursor):
    for table_name, index_name, ddl in index_statements():
        if not _index_exists(cursor, table_name, index_name):
            cursor.execute(ddl)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-dir",
        default=str(Path(__file__).resolve().parent),
    )
    parser.add_argument("--host", default=_env("MYSQL_HOST", "127.0.0.1"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(_env("MYSQL_PORT", "3306")),
    )
    parser.add_argument("--user", default=_env("MYSQL_USER", "root"))
    parser.add_argument("--password", default=_env("MYSQL_PASSWORD", ""))
    parser.add_argument("--database", default=_env("MYSQL_DATABASE", "fooddb"))
    parser.add_argument("--skip-create", action="store_true")
    parser.add_argument("--truncate", action="store_true")
    parser.add_argument("--skip-load", action="store_true")
    parser.add_argument("--skip-indexes", action="store_true")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)

    options = ImportOptions(
        dataset_dir=dataset_dir,
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.database,
        create_tables=not args.skip_create,
        truncate=args.truncate,
        load_data=not args.skip_load,
        create_indexes=not args.skip_indexes,
    )

    run_import(options)


if __name__ == "__main__":
    main()
