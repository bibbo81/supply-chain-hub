-- Aggiunge organizzazione_id a tutte le tabelle rimanenti per multi-tenancy completo
BEGIN;

-- 1. Tabella carriers
ALTER TABLE public.carriers
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

-- Se ci sono dati esistenti, dovrai aggiornarli manualmente
-- UPDATE carriers SET organizzazione_id = 'YOUR-ORG-ID'::uuid WHERE organizzazione_id IS NULL;

-- 2. Tabella api_integrations
ALTER TABLE public.api_integrations
ADD COLUMN IF NOT EXISTS organizzazione_id uuid REFERENCES public.organizzazioni(id) ON DELETE CASCADE;

-- 3. Eventuali altre tabelle che trovi nel database
-- Aggiungi qui altre tabelle se necessario

-- 4. Crea indici per performance
CREATE INDEX IF NOT EXISTS idx_carriers_organizzazione ON public.carriers(organizzazione_id);
CREATE INDEX IF NOT EXISTS idx_api_integrations_organizzazione ON public.api_integrations(organizzazione_id);

-- 5. Abilita RLS su carriers
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo propri carriers" ON public.carriers
    FOR SELECT
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti inseriscono carriers per propria org" ON public.carriers
    FOR INSERT
    WITH CHECK (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti aggiornano solo propri carriers" ON public.carriers
    FOR UPDATE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti eliminano solo propri carriers" ON public.carriers
    FOR DELETE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

-- 6. Abilita RLS su api_integrations
ALTER TABLE public.api_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Utenti vedono solo proprie integrazioni" ON public.api_integrations
    FOR SELECT
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti inseriscono integrazioni per propria org" ON public.api_integrations
    FOR INSERT
    WITH CHECK (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti aggiornano solo proprie integrazioni" ON public.api_integrations
    FOR UPDATE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti eliminano solo proprie integrazioni" ON public.api_integrations
    FOR DELETE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

-- 7. Abilita RLS su shipments (se non già fatto)
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

-- Rimuovi policies esistenti per ricrearle
DROP POLICY IF EXISTS "Utenti vedono solo proprie spedizioni" ON public.shipments;
DROP POLICY IF EXISTS "Utenti inseriscono spedizioni per propria org" ON public.shipments;
DROP POLICY IF EXISTS "Utenti aggiornano solo proprie spedizioni" ON public.shipments;
DROP POLICY IF EXISTS "Utenti eliminano solo proprie spedizioni" ON public.shipments;

CREATE POLICY "Utenti vedono solo proprie spedizioni" ON public.shipments
    FOR SELECT
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti inseriscono spedizioni per propria org" ON public.shipments
    FOR INSERT
    WITH CHECK (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti aggiornano solo proprie spedizioni" ON public.shipments
    FOR UPDATE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti eliminano solo proprie spedizioni" ON public.shipments
    FOR DELETE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

COMMIT;

-- Query di verifica
SELECT 
    table_name,
    COUNT(*) as policies_count
FROM information_schema.tables t
LEFT JOIN pg_policies p ON t.table_name = p.tablename
WHERE t.table_schema = 'public' 
AND t.table_name IN ('shipments', 'carriers', 'api_integrations', 'import_spedizioni')
GROUP BY table_name;