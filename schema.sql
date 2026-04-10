SET SESSION foreign_key_checks = 0;
SET SESSION unique_checks = 0;
SET SESSION sql_mode = '';

CREATE TABLE IF NOT EXISTS nutrient (
  id INT NOT NULL,
  name VARCHAR(255) NULL,
  unit_name VARCHAR(50) NULL,
  nutrient_nbr VARCHAR(20) NULL,
  `rank` DECIMAL(12,3) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_category (
  id INT NOT NULL,
  code VARCHAR(10) NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS measure_unit (
  id INT NOT NULL,
  name VARCHAR(100) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_attribute_type (
  id INT NOT NULL,
  name VARCHAR(100) NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_nutrient_derivation (
  id INT NOT NULL,
  code VARCHAR(10) NULL,
  description VARCHAR(500) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_nutrient_source (
  id INT NOT NULL,
  code VARCHAR(10) NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lab_method (
  id INT NOT NULL,
  description VARCHAR(255) NULL,
  technique VARCHAR(100) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lab_method_code (
  lab_method_id INT NOT NULL,
  code VARCHAR(64) NOT NULL,
  PRIMARY KEY (lab_method_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lab_method_nutrient (
  lab_method_id INT NOT NULL,
  nutrient_id INT NOT NULL,
  PRIMARY KEY (lab_method_id, nutrient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wweia_food_category (
  wweia_food_category INT NOT NULL,
  wweia_food_category_description VARCHAR(255) NULL,
  PRIMARY KEY (wweia_food_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS retention_factor (
  gid INT NOT NULL,
  code INT NULL,
  food_group_id INT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (gid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_update_log_entry (
  id BIGINT NOT NULL,
  description TEXT NULL,
  last_updated DATE NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food (
  fdc_id BIGINT NOT NULL,
  data_type VARCHAR(50) NULL,
  description TEXT NULL,
  food_category_id INT NULL,
  food_category VARCHAR(255) NULL,
  publication_date DATE NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS branded_food (
  fdc_id BIGINT NOT NULL,
  brand_owner VARCHAR(255) NULL,
  brand_name VARCHAR(255) NULL,
  subbrand_name VARCHAR(255) NULL,
  gtin_upc VARCHAR(32) NULL,
  ingredients LONGTEXT NULL,
  not_a_significant_source_of TEXT NULL,
  serving_size DECIMAL(18,6) NULL,
  serving_size_unit VARCHAR(64) NULL,
  household_serving_fulltext VARCHAR(255) NULL,
  branded_food_category VARCHAR(255) NULL,
  data_source VARCHAR(64) NULL,
  package_weight VARCHAR(64) NULL,
  modified_date DATE NULL,
  available_date DATE NULL,
  market_country VARCHAR(64) NULL,
  discontinued_date DATE NULL,
  preparation_state_code VARCHAR(32) NULL,
  trade_channel VARCHAR(64) NULL,
  short_description VARCHAR(255) NULL,
  material_code VARCHAR(64) NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS foundation_food (
  fdc_id BIGINT NOT NULL,
  ndb_number VARCHAR(32) NULL,
  footnote TEXT NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sr_legacy_food (
  fdc_id BIGINT NOT NULL,
  ndb_number VARCHAR(32) NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS survey_fndds_food (
  fdc_id BIGINT NOT NULL,
  food_code VARCHAR(32) NULL,
  wweia_category_code INT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_nutrient (
  id BIGINT NOT NULL,
  fdc_id BIGINT NOT NULL,
  nutrient_id INT NOT NULL,
  amount DECIMAL(18,6) NULL,
  data_points INT NULL,
  derivation_id INT NULL,
  min DECIMAL(18,6) NULL,
  max DECIMAL(18,6) NULL,
  median DECIMAL(18,6) NULL,
  loq DECIMAL(18,6) NULL,
  footnote TEXT NULL,
  min_year_acquired INT NULL,
  percent_daily_value DECIMAL(18,6) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sub_sample_result (
  id BIGINT NOT NULL AUTO_INCREMENT,
  food_nutrient_id BIGINT NOT NULL,
  adjusted_amount DECIMAL(18,6) NULL,
  lab_method_id INT NULL,
  nutrient_name VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sub_sample_result_food_lab (food_nutrient_id, lab_method_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_portion (
  id BIGINT NOT NULL,
  fdc_id BIGINT NOT NULL,
  seq_num INT NULL,
  amount DECIMAL(18,6) NULL,
  measure_unit_id INT NULL,
  portion_description VARCHAR(255) NULL,
  modifier VARCHAR(255) NULL,
  gram_weight DECIMAL(18,6) NULL,
  data_points INT NULL,
  footnote TEXT NULL,
  min_year_acquired INT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_attribute (
  id BIGINT NOT NULL,
  fdc_id BIGINT NOT NULL,
  seq_num INT NULL,
  food_attribute_type_id INT NULL,
  name VARCHAR(255) NULL,
  value TEXT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_component (
  id BIGINT NOT NULL,
  fdc_id BIGINT NOT NULL,
  name VARCHAR(255) NULL,
  pct_weight DECIMAL(10,3) NULL,
  is_refuse CHAR(1) NULL,
  gram_weight DECIMAL(18,6) NULL,
  data_points INT NULL,
  min_year_acquired INT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_nutrient_conversion_factor (
  id BIGINT NOT NULL,
  fdc_id BIGINT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_calorie_conversion_factor (
  food_nutrient_conversion_factor_id BIGINT NOT NULL,
  protein_value DECIMAL(10,3) NULL,
  fat_value DECIMAL(10,3) NULL,
  carbohydrate_value DECIMAL(10,3) NULL,
  PRIMARY KEY (food_nutrient_conversion_factor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS food_protein_conversion_factor (
  food_nutrient_conversion_factor_id BIGINT NOT NULL,
  value DECIMAL(10,3) NULL,
  PRIMARY KEY (food_nutrient_conversion_factor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS input_food (
  id BIGINT NOT NULL,
  fdc_id BIGINT NOT NULL,
  fdc_id_of_input_food BIGINT NULL,
  seq_num INT NULL,
  amount DECIMAL(18,6) NULL,
  sr_code VARCHAR(32) NULL,
  sr_description TEXT NULL,
  unit VARCHAR(32) NULL,
  portion_code VARCHAR(32) NULL,
  portion_description VARCHAR(255) NULL,
  gram_weight DECIMAL(18,6) NULL,
  retention_code VARCHAR(32) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sample_food (
  fdc_id BIGINT NOT NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sub_sample_food (
  fdc_id BIGINT NOT NULL,
  fdc_id_of_sample_food BIGINT NOT NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS market_acquisition (
  fdc_id BIGINT NOT NULL,
  brand_description VARCHAR(255) NULL,
  expiration_date DATE NULL,
  label_weight VARCHAR(64) NULL,
  location VARCHAR(64) NULL,
  acquisition_date DATE NULL,
  sales_type VARCHAR(64) NULL,
  sample_lot_nbr VARCHAR(64) NULL,
  sell_by_date DATE NULL,
  store_city VARCHAR(128) NULL,
  store_name VARCHAR(255) NULL,
  store_state VARCHAR(32) NULL,
  upc_code VARCHAR(64) NULL,
  acquisition_number VARCHAR(64) NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acquisition_samples (
  fdc_id_of_sample_food BIGINT NOT NULL,
  fdc_id_of_acquisition_food BIGINT NOT NULL,
  PRIMARY KEY (fdc_id_of_sample_food, fdc_id_of_acquisition_food)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agricultural_samples (
  fdc_id BIGINT NOT NULL,
  acquisition_date DATE NULL,
  market_class VARCHAR(128) NULL,
  treatment VARCHAR(128) NULL,
  state VARCHAR(16) NULL,
  PRIMARY KEY (fdc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS microbe (
  id INT NOT NULL,
  fdc_id BIGINT NULL,
  method VARCHAR(64) NULL,
  microbe_code VARCHAR(128) NULL,
  min_value BIGINT NULL,
  max_value BIGINT NULL,
  uom VARCHAR(32) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fndds_derivation (
  derivation_code VARCHAR(16) NOT NULL,
  derivation_description VARCHAR(255) NULL,
  PRIMARY KEY (derivation_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fndds_ingredient_nutrient_value (
  ingredient_code INT NULL,
  ingredient_description VARCHAR(255) NULL,
  nutrient_code INT NULL,
  nutrient_value DECIMAL(18,6) NULL,
  nutrient_value_source VARCHAR(64) NULL,
  fdc_id BIGINT NULL,
  derivation_code VARCHAR(16) NULL,
  sr_addmod_year INT NULL,
  foundation_year_acquired INT NULL,
  start_date DATE NULL,
  end_date DATE NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET SESSION foreign_key_checks = 1;
SET SESSION unique_checks = 1;

CREATE INDEX idx_food_nutrient_fdc_id ON food_nutrient (fdc_id);
CREATE INDEX idx_food_nutrient_nutrient_id ON food_nutrient (nutrient_id);
CREATE INDEX idx_food_nutrient_fdc_nutrient ON food_nutrient (fdc_id, nutrient_id);
CREATE INDEX idx_food_portion_fdc_id ON food_portion (fdc_id);
CREATE INDEX idx_food_attribute_fdc_id ON food_attribute (fdc_id);
CREATE INDEX idx_food_component_fdc_id ON food_component (fdc_id);
CREATE INDEX idx_input_food_fdc_id ON input_food (fdc_id);
CREATE INDEX idx_survey_fndds_food_wweia ON survey_fndds_food (wweia_category_code);
CREATE INDEX idx_food_nutrient_conversion_factor_fdc_id ON food_nutrient_conversion_factor (fdc_id);
CREATE INDEX idx_sub_sample_food_sample ON sub_sample_food (fdc_id_of_sample_food);
CREATE INDEX idx_market_acquisition_upc ON market_acquisition (upc_code);
