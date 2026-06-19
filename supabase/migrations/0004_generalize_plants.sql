-- Rename trees to plants
ALTER TABLE public.trees RENAME TO plants;

-- Add plant_type column to plants (e.g. tree, shrub, flower, succulent, vegetable, herb, vine, other)
ALTER TABLE public.plants ADD COLUMN plant_type text NOT NULL DEFAULT 'tree';

-- Add species column to plants
ALTER TABLE public.plants ADD COLUMN species text;

-- Add zip_code column to plants
ALTER TABLE public.plants ADD COLUMN zip_code text;


-- Rename assessments.tree_id column to plant_id
ALTER TABLE public.assessments RENAME COLUMN tree_id TO plant_id;

-- Add columns for Visual Cut-Care tracker
ALTER TABLE public.assessments ADD COLUMN is_cut_care boolean NOT NULL DEFAULT false;
ALTER TABLE public.assessments ADD COLUMN cut_health_score integer;

-- Rename constraints and indexes to match 'plants' naming
ALTER TABLE public.plants RENAME CONSTRAINT trees_pkey TO plants_pkey;
ALTER TABLE public.plants RENAME CONSTRAINT trees_cover_assessment_id_fkey TO plants_cover_assessment_id_fkey;

ALTER TABLE public.assessments RENAME CONSTRAINT assessments_tree_id_fkey TO assessments_plant_id_fkey;

ALTER INDEX IF EXISTS trees_user_id_idx RENAME TO plants_user_id_idx;
ALTER INDEX IF EXISTS assessments_tree_id_idx RENAME TO assessments_plant_id_idx;
ALTER INDEX IF EXISTS assessments_tree_created_idx RENAME TO assessments_plant_created_idx;
