# FoodData Central (FDC) MySQL Schema Layout

## Core entity

- **food**
  - **PK:** `fdc_id`
  - **Columns:** `data_type`, `description`, `publication_date`
  - **Category handling:**
    - If the source `food.csv.food_category_id` value is numeric it is stored in `food.food_category_id`.
    - If it is not numeric it is stored in `food.food_category` (string).

## Main nutrition linkage

- **nutrient**
  - **PK:** `id`

- **food_nutrient**
  - **PK:** `id`
  - **FK (logical):** `fdc_id -> food.fdc_id`
  - **FK (logical):** `nutrient_id -> nutrient.id`
  - **FK (logical):** `derivation_id -> food_nutrient_derivation.id`
  - **Purpose:** nutrient amounts per food.

- **food_nutrient_derivation**
  - **PK:** `id`
  - **Purpose:** derivation codes used by `food_nutrient.derivation_id`.

- **food_nutrient_source**
  - **PK:** `id`
  - **Purpose:** source code lookup (not currently referenced directly by the imported tables).

## Type-specific food extensions (1:1 with food)

- **branded_food**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`

- **foundation_food**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`

- **sr_legacy_food**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`

- **survey_fndds_food**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`
  - **FK (logical):** `wweia_category_code -> wweia_food_category.wweia_food_category`

## Portions and measures

- **measure_unit**
  - **PK:** `id`

- **food_portion**
  - **PK:** `id`
  - **FK (logical):** `fdc_id -> food.fdc_id`
  - **FK (logical):** `measure_unit_id -> measure_unit.id`

## Attributes and components

- **food_attribute_type**
  - **PK:** `id`

- **food_attribute**
  - **PK:** `id`
  - **FK (logical):** `fdc_id -> food.fdc_id`
  - **FK (logical):** `food_attribute_type_id -> food_attribute_type.id` (often blank in your data)

- **food_component**
  - **PK:** `id`
  - **FK (logical):** `fdc_id -> food.fdc_id`

## Recipe / formulation inputs

- **input_food**
  - **PK:** `id`
  - **FK (logical):** `fdc_id -> food.fdc_id`
  - **Self-reference (logical):** `fdc_id_of_input_food -> food.fdc_id` (nullable)

## Sample / acquisition graph

- **sample_food**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`

- **sub_sample_food**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`
  - **FK (logical):** `fdc_id_of_sample_food -> sample_food.fdc_id`

- **market_acquisition**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`

- **acquisition_samples**
  - **PK:** `(fdc_id_of_sample_food, fdc_id_of_acquisition_food)`
  - **FK (logical):** `fdc_id_of_sample_food -> sample_food.fdc_id`
  - **FK (logical):** `fdc_id_of_acquisition_food -> market_acquisition.fdc_id`

- **agricultural_samples**
  - **PK/FK (logical):** `fdc_id -> food.fdc_id`

## Lab methods and sub-sample results

- **lab_method**
  - **PK:** `id`

- **lab_method_code**
  - **PK:** `(lab_method_id, code)`

- **lab_method_nutrient**
  - **PK:** `(lab_method_id, nutrient_id)`

- **sub_sample_result**
  - **PK:** `id`
  - **Unique (logical):** `(food_nutrient_id, lab_method_id)`
  - **FK (logical):** `food_nutrient_id -> food_nutrient.id`
  - **FK (logical):** `lab_method_id -> lab_method.id`

## Misc

- **food_category**
  - **PK:** `id`

- **wweia_food_category**
  - **PK:** `wweia_food_category`

- **retention_factor**
  - **PK:** `gid`

- **food_update_log_entry**
  - **PK:** `id`

- **microbe**
  - **PK:** `id`
  - **FK (logical):** `fdc_id -> food.fdc_id`

- **fndds_derivation**
  - **PK:** `derivation_code`

- **fndds_ingredient_nutrient_value**
  - No declared PK in this simplified schema.
  - Contains `fdc_id` and derivation code references.

## Import order (high level)

1. Lookup tables (`nutrient`, `measure_unit`, derivations, lab methods, WWEIA)
2. `food`
3. Type-specific extensions (`branded_food`, `foundation_food`, `sr_legacy_food`, `survey_fndds_food`)
4. `food_nutrient` (largest)
5. Dependent detail tables (`sub_sample_result`, `food_portion`, `food_attribute`, `food_component`, `input_food`)
6. Sample/acquisition tables
7. Index creation
