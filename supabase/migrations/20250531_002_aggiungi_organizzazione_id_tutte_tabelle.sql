-- Migration per aggiungere organizzazione_id a TUTTE le tabelle esistenti
BEGIN;

-- =====================================================
-- 1. CARRIERS
-- =====================================================
ALTER TABLE public.carriers
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

-- Aggiorna eventuali record esistenti
UPDATE carriers 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

-- Rendi la colonna NOT NULL dopo l'aggiornamento
ALTER TABLE public.carriers
ALTER COLUMN organizzazione_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_carriers_organizzazione ON public.carriers(organizzazione_id);

-- =====================================================
-- 2. API_CONFIG
-- =====================================================
ALTER TABLE public.api_config
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

UPDATE api_config 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

ALTER TABLE public.api_config
ALTER COLUMN organizzazione_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_config_organizzazione ON public.api_config(organizzazione_id);

-- =====================================================
-- 3. API_CONFIGURATIONS
-- =====================================================
ALTER TABLE public.api_configurations
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

UPDATE api_configurations 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

ALTER TABLE public.api_configurations
ALTER COLUMN organizzazione_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_configurations_organizzazione ON public.api_configurations(organizzazione_id);

-- =====================================================
-- 4. IMPORT_AEREA
-- =====================================================
ALTER TABLE public.import_aerea
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

UPDATE import_aerea 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

ALTER TABLE public.import_aerea
ALTER COLUMN organizzazione_id SET NOT NULL;

-- Aggiungi anche tipo_spedizione per uniformità
ALTER TABLE public.import_aerea
ADD COLUMN IF NOT EXISTS tipo_spedizione VARCHAR(50) DEFAULT 'aereo';

CREATE INDEX IF NOT EXISTS idx_import_aerea_organizzazione ON public.import_aerea(organizzazione_id);

-- =====================================================
-- 5. IMPORT_PARCEL
-- =====================================================
ALTER TABLE public.import_parcel
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

UPDATE import_parcel 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

ALTER TABLE public.import_parcel
ALTER COLUMN organizzazione_id SET NOT NULL;

-- Aggiungi anche tipo_spedizione per uniformità
ALTER TABLE public.import_parcel
ADD COLUMN IF NOT EXISTS tipo_spedizione VARCHAR(50) DEFAULT 'strada';

CREATE INDEX IF NOT EXISTS idx_import_parcel_organizzazione ON public.import_parcel(organizzazione_id);

-- =====================================================
-- 6. ARTICLES_DATABASE
-- =====================================================
ALTER TABLE public.articles_database
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

UPDATE articles_database 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

ALTER TABLE public.articles_database
ALTER COLUMN organizzazione_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_database_organizzazione ON public.articles_database(organizzazione_id);

-- =====================================================
-- 7. SHIPMENTS (aggiorna se necessario)
-- =====================================================
-- Shipments ha già organizzazione_id, ma assicuriamoci che sia NOT NULL
UPDATE shipments 
SET organizzazione_id = 'bb70d86e-bf38-4a85-adc3-76be46705d52'::uuid 
WHERE organizzazione_id IS NULL;

-- Solo se ci sono record con NULL, altrimenti salta
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM shipments WHERE organizzazione_id IS NULL) THEN
        ALTER TABLE public.shipments
        ALTER COLUMN organizzazione_id SET NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_organizzazione ON public.shipments(organizzazione_id);

-- =====================================================
-- RLS POLICIES PER TUTTE LE TABELLE
-- =====================================================

-- CARRIERS
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Utenti vedono solo propri carriers" ON public.carriers;
DROP POLICY IF EXISTS "Utenti inseriscono carriers per propria org" ON public.carriers;
DROP POLICY IF EXISTS "Utenti aggiornano solo propri carriers" ON public.carriers;
DROP POLICY IF EXISTS "Utenti eliminano solo propri carriers" ON public.carriers;

CREATE POLICY "Utenti vedono solo propri carriers" ON public.carriers
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono carriers per propria org" ON public.carriers
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo propri carriers" ON public.carriers
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo propri carriers" ON public.carriers
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

-- API_CONFIG
ALTER TABLE public.api_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo proprie api_config" ON public.api_config
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono api_config per propria org" ON public.api_config
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo proprie api_config" ON public.api_config
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo proprie api_config" ON public.api_config
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

-- API_CONFIGURATIONS
ALTER TABLE public.api_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo proprie api_configurations" ON public.api_configurations
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono api_configurations per propria org" ON public.api_configurations
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo proprie api_configurations" ON public.api_configurations
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo proprie api_configurations" ON public.api_configurations
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

-- IMPORT_AEREA
ALTER TABLE public.import_aerea ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo proprie import_aerea" ON public.import_aerea
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono import_aerea per propria org" ON public.import_aerea
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo proprie import_aerea" ON public.import_aerea
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo proprie import_aerea" ON public.import_aerea
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

-- IMPORT_PARCEL
ALTER TABLE public.import_parcel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo proprie import_parcel" ON public.import_parcel
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono import_parcel per propria org" ON public.import_parcel
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo proprie import_parcel" ON public.import_parcel
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo proprie import_parcel" ON public.import_parcel
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

-- ARTICLES_DATABASE
ALTER TABLE public.articles_database ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo propri articles" ON public.articles_database
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono articles per propria org" ON public.articles_database
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo propri articles" ON public.articles_database
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo propri articles" ON public.articles_database
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

-- SHIPMENTS
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Utenti vedono solo proprie spedizioni" ON public.shipments;
DROP POLICY IF EXISTS "Utenti inseriscono spedizioni per propria org" ON public.shipments;
DROP POLICY IF EXISTS "Utenti aggiornano solo proprie spedizioni" ON public.shipments;
DROP POLICY IF EXISTS "Utenti eliminano solo proprie spedizioni" ON public.shipments;

CREATE POLICY "Utenti vedono solo proprie spedizioni" ON public.shipments
    FOR SELECT USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti inseriscono spedizioni per propria org" ON public.shipments
    FOR INSERT WITH CHECK (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti aggiornano solo proprie spedizioni" ON public.shipments
    FOR UPDATE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

CREATE POLICY "Utenti eliminano solo proprie spedizioni" ON public.shipments
    FOR DELETE USING (organizzazione_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid));

COMMIT;

-- Query di verifica finale
SELECT 
    t.table_name,
    EXISTS(
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = t.table_name 
        AND column_name = 'organizzazione_id'
    ) as ha_org_id,
    COUNT(p.policyname) as num_policies
FROM information_schema.tables t
LEFT JOIN pg_policies p ON t.table_name = p.tablename
WHERE t.table_schema = 'public' 
AND t.table_type = 'BASE TABLE'
AND t.table_name != 'organizzazioni'
GROUP BY t.table_name
ORDER BY t.table_name;