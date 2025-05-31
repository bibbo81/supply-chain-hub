-- Migration per sistemare import_mare (vuota) e renderla multi-tenant
BEGIN;

-- 1. Rinomina la tabella per maggiore chiarezza
ALTER TABLE public.import_mare RENAME TO import_spedizioni;

-- 2. Rinomina la sequence dell'ID
ALTER SEQUENCE IF EXISTS import_spedizioni_id_seq RENAME TO import_spedizioni_old_id_seq;

-- 3. Rimuovi il default dalla colonna company_id (deprecata)
ALTER TABLE public.import_spedizioni ALTER COLUMN company_id DROP DEFAULT;

-- 4. Sistema la colonna organizzazione_id
ALTER TABLE public.import_spedizioni 
ALTER COLUMN organizzazione_id SET NOT NULL;

-- 5. Aggiungi foreign key constraint
ALTER TABLE public.import_spedizioni
ADD CONSTRAINT fk_import_spedizioni_organizzazione
FOREIGN KEY (organizzazione_id) 
REFERENCES public.organizzazioni(id) 
ON DELETE CASCADE;

-- 6. Aggiungi colonne mancanti per gestione completa spedizioni
ALTER TABLE public.import_spedizioni 
ADD COLUMN IF NOT EXISTS tipo_spedizione VARCHAR(50) DEFAULT 'mare',
ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255),
ADD COLUMN IF NOT EXISTS carrier VARCHAR(255),
ADD COLUMN IF NOT EXISTS peso_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS volume_cbm DECIMAL(10,3),
ADD COLUMN IF NOT EXISTS numero_colli INTEGER,
ADD COLUMN IF NOT EXISTS descrizione_merce TEXT,
ADD COLUMN IF NOT EXISTS costo_trasporto DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS costo_dogana DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS altri_costi DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS valuta VARCHAR(3) DEFAULT 'EUR',
ADD COLUMN IF NOT EXISTS numero_fattura VARCHAR(100),
ADD COLUMN IF NOT EXISTS numero_dichiarazione_doganale VARCHAR(100),
ADD COLUMN IF NOT EXISTS note TEXT,
ADD COLUMN IF NOT EXISTS dati_originali JSONB,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- 7. Aggiungi constraint per tipo_spedizione
ALTER TABLE public.import_spedizioni 
ADD CONSTRAINT chk_tipo_spedizione CHECK (tipo_spedizione IN ('mare', 'aereo', 'strada'));

-- 8. Migra i dati esistenti da shipping_line a carrier
UPDATE public.import_spedizioni 
SET carrier = shipping_line 
WHERE carrier IS NULL AND shipping_line IS NOT NULL;

-- 9. Crea colonna calcolata per costo totale
ALTER TABLE public.import_spedizioni 
ADD COLUMN costo_totale DECIMAL(10,2) 
GENERATED ALWAYS AS (
    COALESCE(costo_trasporto, 0) + 
    COALESCE(costo_dogana, 0) + 
    COALESCE(altri_costi, 0)
) STORED;

-- 10. Crea indici per performance
CREATE INDEX idx_import_spedizioni_organizzazione ON public.import_spedizioni(organizzazione_id);
CREATE INDEX idx_import_spedizioni_tracking ON public.import_spedizioni(tracking_number);
CREATE INDEX idx_import_spedizioni_container ON public.import_spedizioni(container_number);
CREATE INDEX idx_import_spedizioni_tipo ON public.import_spedizioni(tipo_spedizione);
CREATE INDEX idx_import_spedizioni_status ON public.import_spedizioni(status);
CREATE INDEX idx_import_spedizioni_departure ON public.import_spedizioni(departure_date);
CREATE INDEX idx_import_spedizioni_arrival ON public.import_spedizioni(arrival_date);

-- 11. Abilita RLS
ALTER TABLE public.import_spedizioni ENABLE ROW LEVEL SECURITY;

-- 12. Crea le RLS policies
CREATE POLICY "Utenti vedono solo proprie spedizioni importate" ON public.import_spedizioni
    FOR SELECT
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti inseriscono spedizioni per propria org" ON public.import_spedizioni
    FOR INSERT
    WITH CHECK (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti aggiornano solo proprie spedizioni" ON public.import_spedizioni
    FOR UPDATE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

CREATE POLICY "Utenti eliminano solo proprie spedizioni" ON public.import_spedizioni
    FOR DELETE
    USING (
        organizzazione_id = (
            SELECT (auth.jwt() -> 'app_metadata' ->> 'organizzazione_id')::uuid
        )
    );

-- 13. Trigger per updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_import_spedizioni_updated_at ON public.import_spedizioni;

CREATE TRIGGER update_import_spedizioni_updated_at 
    BEFORE UPDATE ON public.import_spedizioni 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- 14. Commenti per documentazione
COMMENT ON TABLE public.import_spedizioni IS 'Tabella per salvare i dati importati da file Excel/CSV delle spedizioni (mare, aereo, strada)';
COMMENT ON COLUMN public.import_spedizioni.tipo_spedizione IS 'Tipo di spedizione: mare, aereo o strada';
COMMENT ON COLUMN public.import_spedizioni.dati_originali IS 'JSON con i dati raw del file importato per riferimento';
COMMENT ON COLUMN public.import_spedizioni.organizzazione_id IS 'ID organizzazione per multi-tenancy (obbligatorio)';
COMMENT ON COLUMN public.import_spedizioni.company_id IS 'DEPRECATO: usare organizzazione_id. Mantenuto solo per compatibilità';
COMMENT ON COLUMN public.import_spedizioni.costo_totale IS 'Somma automatica di costo_trasporto + costo_dogana + altri_costi';

-- 15. Vista di riepilogo per organizzazione
CREATE OR REPLACE VIEW v_import_spedizioni_summary AS
SELECT 
    organizzazione_id,
    tipo_spedizione,
    COUNT(*) as totale_spedizioni,
    COUNT(DISTINCT container_number) as totale_container,
    COUNT(CASE WHEN status = 'in_transit' THEN 1 END) as in_transito,
    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as consegnate,
    COUNT(CASE WHEN delay_days > 0 THEN 1 END) as con_ritardo,
    AVG(transit_time_days) as tempo_transito_medio,
    AVG(delay_days) as ritardo_medio,
    SUM(costo_trasporto) as totale_costo_trasporto,
    SUM(costo_dogana) as totale_costo_dogana,
    SUM(altri_costi) as totale_altri_costi,
    SUM(costo_totale) as totale_costi,
    MAX(created_at) as ultima_importazione
FROM import_spedizioni
GROUP BY organizzazione_id, tipo_spedizione;

-- Grant accesso alla vista
GRANT SELECT ON v_import_spedizioni_summary TO authenticated;

COMMIT;

-- Query di verifica finale
SELECT 
    tablename,
    'Tabella rinominata e aggiornata con successo!' as status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'import_spedizioni';