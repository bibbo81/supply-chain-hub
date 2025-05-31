-- Crea una vista unificata per tutti i tipi di import
CREATE OR REPLACE VIEW v_all_imports AS
SELECT 
    -- Campi comuni
    organizzazione_id,
    'mare' as tipo_spedizione,
    container_number as riferimento_spedizione,
    container_number,
    shipping_line as carrier,
    status as stato,
    origin_country as paese_origine,
    destination_country as paese_destinazione,
    pol as porto_partenza,
    pod as porto_arrivo,
    departure_date as data_partenza,
    arrival_date as data_arrivo_prevista,
    discharge_date as data_arrivo_effettiva,
    transit_time_days as tempo_transito_giorni,
    delay_days as giorni_ritardo,
    tracking_events,
    created_at,
    updated_at
FROM import_spedizioni
WHERE tipo_spedizione = 'mare' OR tipo_spedizione IS NULL

UNION ALL

SELECT 
    organizzazione_id,
    COALESCE(tipo_spedizione, 'aereo') as tipo_spedizione,
    tracking_number as riferimento_spedizione,
    NULL as container_number,
    carrier,
    status as stato,
    origin_country as paese_origine,
    destination_country as paese_destinazione,
    origin_airport as porto_partenza,
    destination_airport as porto_arrivo,
    departure_date as data_partenza,
    arrival_date as data_arrivo_prevista,
    actual_arrival_date as data_arrivo_effettiva,
    NULL as tempo_transito_giorni,
    NULL as giorni_ritardo,
    NULL as tracking_events,
    created_at,
    updated_at
FROM import_aerea

UNION ALL

SELECT 
    organizzazione_id,
    COALESCE(tipo_spedizione, 'strada') as tipo_spedizione,
    tracking_number as riferimento_spedizione,
    NULL as container_number,
    carrier,
    status as stato,
    origin_country as paese_origine,
    destination_country as paese_destinazione,
    origin_city as porto_partenza,
    destination_city as porto_arrivo,
    pickup_date as data_partenza,
    estimated_delivery as data_arrivo_prevista,
    actual_delivery as data_arrivo_effettiva,
    NULL as tempo_transito_giorni,
    NULL as giorni_ritardo,
    NULL as tracking_events,
    created_at,
    updated_at
FROM import_parcel;

-- Grant accesso alla vista
GRANT SELECT ON v_all_imports TO authenticated;

-- Commento
COMMENT ON VIEW v_all_imports IS 'Vista unificata di tutti i tipi di importazione (mare, aereo, strada)';