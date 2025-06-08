// netlify/functions/import-csv-containers.js
const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const XLSX = require('xlsx');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mappatura carrier names ShipsGo → nostri codici
const SHIPSGO_CARRIER_MAPPING = {
  'MAERSK LINE': 'MAERSK',
  'MSC': 'MSC',
  'CMA CGM': 'CMA-CGM',
  'COSCO': 'COSCO',
  'HAPAG-LLOYD': 'HAPAG-LLOYD',
  'ONE': 'ONE',
  'EVERGREEN': 'EVERGREEN',
  'YANG MING': 'YANG-MING',
  'ZIM': 'ZIM',
  'HMM': 'HMM',
  'OOCL': 'OOCL',
  'APL': 'APL',
  'NYK': 'NYK',
  'MOL': 'MOL',
  'K LINE': 'K-LINE'
};

// Mappatura COMPLETA status (TUTTI dal tuo Google Sheets IFS)
const SHIPSGO_STATUS_MAPPING = {
  // STATI MARITTIMI
  'Sailing': 'in_transit',
  'Arrived': 'in_transit',
  'Delivered': 'delivered',
  'Discharged': 'delivered',
  
  // STATI FEDEX
  'On FedEx vehicle for delivery': 'out_for_delivery',
  'At local FedEx facility': 'in_transit',
  'Departed FedEx hub': 'in_transit',
  'On the way': 'in_transit',
  'Arrived at FedEx hub': 'in_transit',
  'International shipment release - Import': 'in_transit',
  'At destination sort facility': 'in_transit',
  'Left FedEx origin facility': 'in_transit',
  'Picked up': 'in_transit',
  'Shipment information sent to FedEx': 'registered',
  
  // STATI GLS
  'Consegnata.': 'delivered',
  'Consegna prevista nel corso della giornata odierna.': 'out_for_delivery',
  'Arrivata nella Sede GLS locale.': 'in_transit',
  'In transito.': 'in_transit',
  'Partita dalla sede mittente. In transito.': 'in_transit',
  "La spedizione e' stata creata dal mittente, attendiamo che ci venga affidata per l'invio a destinazione.": 'registered',
  
  // STATI GENERICI ITALIANI (TUTTI DAL TUO IFS)
  'LA spedizione è stata consegnata': 'delivered',
  'La spedizione è stata consegnata': 'delivered',
  'La spedizione è in consegna': 'out_for_delivery',
  'La spedizione è in transito': 'in_transit',
  
  // ALTRI STATI "IN CONSEGNA"
  'Out for Delivery': 'out_for_delivery',
  'With delivery courier': 'out_for_delivery',
  'On UPS vehicle for delivery': 'out_for_delivery',
  'On DHL vehicle for delivery': 'out_for_delivery',
  
  // STATI SHIPSGO ORIGINALI
  'Gate In': 'in_transit',
  'Gate Out': 'in_transit',
  'Loaded': 'in_transit',
  'Loaded on Vessel': 'in_transit',
  'Vessel Departed': 'in_transit',
  'Vessel Arrived': 'in_transit',
  'Empty': 'delivered',
  'Empty Returned': 'delivered',
  'Empty Container Returned': 'delivered',
  'Registered': 'registered',
  'Pending': 'registered',
  'In Transit': 'in_transit',
  'Transhipment': 'in_transit',
  'Rail Departed': 'in_transit',
  'Customs Hold': 'delayed',
  'Rolled': 'delayed',
  'Cancelled': 'cancelled',
  
  // STATI DHL
  'Shipment information received': 'registered',
  'Shipment picked up': 'in_transit',
  'Processed': 'in_transit',
  'Departed Facility': 'in_transit',
  'Arrived Facility': 'in_transit',
  'Delivered': 'delivered',
  'Signed': 'delivered',
  
  // STATI UPS  
  'Order Processed': 'registered',
  'Out For Delivery': 'out_for_delivery',
  'Exception': 'exception',
  'Returned to Sender': 'exception',
  'Delivery Attempted': 'delayed',
  'Customer not Available': 'delayed',
  'Incorrect Address': 'exception'
};

// Mappatura eventi da status ShipsGo
const STATUS_TO_EVENT_MAPPING = {
  'Gate In': { type: 'GATE_IN', code: 'GIN', description: 'Container entered terminal' },
  'Gate Out': { type: 'GATE_OUT', code: 'GOUT', description: 'Container left terminal' },
  'Loaded': { type: 'LOADED_ON_VESSEL', code: 'LOD', description: 'Container loaded on vessel' },
  'Discharged': { type: 'DISCHARGED_FROM_VESSEL', code: 'DIS', description: 'Container discharged from vessel' },
  'Delivered': { type: 'DELIVERED', code: 'DEL', description: 'Container delivered to consignee' },
  'Empty': { type: 'EMPTY_RETURNED', code: 'ERT', description: 'Empty container returned' },
  'In Transit': { type: 'DEPARTED', code: 'DEP', description: 'Vessel departed' }
};

// Parse data ShipsGo formato DD/MM/YYYY o DD/MM/YYYY HH:MM:SS
function parseShipsGoDate(dateStr) {
  if (!dateStr || dateStr === '-' || dateStr === '') return null;
  
  try {
    // Rimuovi eventuale orario
    const cleanDate = dateStr.split(' ')[0];
    const [day, month, year] = cleanDate.split('/');
    
    if (!day || !month || !year) return null;
    
    // Crea data in formato ISO
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const date = new Date(isoDate);
    
    // Verifica che sia una data valida
    if (isNaN(date.getTime())) return null;
    
    return date.toISOString();
  } catch (error) {
    console.error('Error parsing date:', dateStr, error);
    return null;
  }
}

// Estrai codice porto da stringa tipo "SHANGHAI, CN"
function extractPortCode(portString) {
  if (!portString || portString === '-') return null;
  
  // Se già un codice porto (5 caratteri maiuscoli)
  if (/^[A-Z]{5}$/.test(portString)) return portString;
  
  // Altrimenti prendi prime 5 lettere e uppercase
  return portString.replace(/[^A-Z]/gi, '').substring(0, 5).toUpperCase() || null;
}

// Estrai nome pulito del porto
function extractPortName(portString) {
  if (!portString || portString === '-') return null;
  
  // Rimuovi codice paese se presente
  const parts = portString.split(',');
  return parts[0].trim();
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Verifica autenticazione
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Get user's organization
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organizzazione_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    // Parse request body
    const { csvData, xlsxData, options = {} } = JSON.parse(event.body);
    
    if (!csvData && !xlsxData) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'CSV or XLSX data required' })
      };
    }

    // Opzioni di import
    const {
      skipDuplicates = true,
      updateExisting = false,
      importEvents = true,
      batchSize = 50
    } = options;

    // Parse CSV or Excel
    let rows = [];
    
    if (xlsxData) {
      // Parse Excel data (base64 encoded)
      console.log('Processing Excel file...');
      try {
        const buffer = Buffer.from(xlsxData, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(worksheet, { raw: false });
        console.log(`Parsed ${rows.length} rows from Excel`);
      } catch (error) {
        console.error('Excel parse error:', error);
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'Excel parsing failed', 
            details: error.message 
          })
        };
      }
    } else {
      // Parse CSV
      const parseResult = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim()
      });

      if (parseResult.errors.length > 0) {
        console.error('CSV parse errors:', parseResult.errors);
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'CSV parsing failed', 
            details: parseResult.errors 
          })
        };
      }
      
      rows = parseResult.data;
    }
    
    console.log(`Processing ${rows.length} rows from ${xlsxData ? 'Excel' : 'CSV'}`);

    // Rileva formato ShipsGo
    const isShipsGoFormat = rows.length > 0 && (
      'Container' in rows[0] || 
      'container' in rows[0] ||
      'CONTAINER' in rows[0] ||
      'Container Number' in rows[0]
    );

    // Statistiche
    const stats = {
      total: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      events_created: 0
    };
    const errors = [];

    // Processa in batch
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (row, batchIndex) => {
        const rowIndex = i + batchIndex + 2; // +2 per header e indice 0
        
        try {
          // Salta righe vuote - gestisci vari formati di nome colonna
          const containerValue = row.Container || row.container || row.CONTAINER || 
                               row['Container Number'] || row['container number'] || 
                               row['CONTAINER NUMBER'] || '';
                               
          if (!containerValue || containerValue === '-' || containerValue === '') {
            stats.skipped++;
            return;
          }

          stats.total++;

          // Prepara dati tracking
          const containerNum = containerValue.trim().toUpperCase();
          
          // Determina il tipo
          let trackingType = 'container';
          if (containerNum.length > 11 && /^[A-Z]{4}\d{8,}$/.test(containerNum)) {
            trackingType = 'bl';
          }

          // Mappa il carrier
          const carrierName = row.Carrier || row['Shipping Line'] || '';
          const carrierCode = SHIPSGO_CARRIER_MAPPING[carrierName] || 
                            Object.keys(SHIPSGO_CARRIER_MAPPING).find(key => 
                              carrierName.toUpperCase().includes(key.toUpperCase())
                            ) || carrierName.substring(0, 10);

          // Parse date
          const loadingDate = parseShipsGoDate(row['Date Of Loading']);
          const dischargeDate = parseShipsGoDate(row['Date Of Discharge']);
          
          // Calcola ETA se discharge date è nel futuro
          let eta = null;
          if (dischargeDate && new Date(dischargeDate) > new Date()) {
            eta = dischargeDate;
          }

          // Prepara metadata con tutti i dati extra
          const metadata = {
            source: 'shipsgo_csv_import',
            import_date: new Date().toISOString(),
            import_user: user.email,
            shipsgo_status: row.Status,
            booking_number: row.Booking !== '-' ? row.Booking : null,
            co2_emissions_tons: row['CO₂ Emission (Tons)'] && row['CO₂ Emission (Tons)'] !== '-' 
              ? parseFloat(row['CO₂ Emission (Tons)']) : null,
            pol_full: row['Port Of Loading'],
            pod_full: row['Port Of Discharge'],
            pol_country: row['POL Country'],
            pod_country: row['POD Country'],
            loading_date: loadingDate,
            discharge_date: dischargeDate,
            transit_time_days: null,
            tags: row.Tags !== '-' ? row.Tags : null,
            container_count: parseInt(row['Container Count']) || 1,
            container_size: row['Container Size'] || null,
            container_type: row['Container Type'] || null
          };

          // Calcola transit time se abbiamo entrambe le date
          if (loadingDate && dischargeDate) {
            const diff = new Date(dischargeDate) - new Date(loadingDate);
            metadata.transit_time_days = Math.floor(diff / (1000 * 60 * 60 * 24));
          }

          // IMPORTANTE: Usa SEMPRE lo status dal CSV come fonte primaria
          let finalStatus = 'registered'; // default
          
          // Prima controlla il mapping diretto dello status CSV
          if (row.Status && row.Status !== '-') {
            finalStatus = SHIPSGO_STATUS_MAPPING[row.Status] || 'in_transit';
          }
          
          // Override solo se non c'è status nel CSV
          if (!row.Status || row.Status === '-') {
            // Logica basata su date solo come fallback
            if (dischargeDate && new Date(dischargeDate) < new Date()) {
              finalStatus = 'delivered';
            } else if (loadingDate && new Date(loadingDate) < new Date()) {
              finalStatus = 'in_transit';
            }
          }
          
          console.log(`Container ${containerNum}: CSV Status='${row.Status}' → System Status='${finalStatus}'`);

          // Prepara dati tracking PRIMA di controllare esistenza
          const trackingData = {
            organizzazione_id: profile.organizzazione_id,
            tracking_number: containerNum,
            tracking_type: trackingType,
            reference_number: row.Reference !== '-' ? row.Reference : null,
            carrier_code: carrierCode,
            carrier_name: carrierName,
            origin_port: extractPortCode(row['Port Of Loading']),
            origin_name: extractPortName(row['Port Of Loading']),
            destination_port: extractPortCode(row['Port Of Discharge']),
            destination_name: extractPortName(row['Port Of Discharge']),
            status: finalStatus,
            eta: eta,
            metadata: metadata
          };

          // Controlla se esiste già (anche inattivi)
          const { data: existingActive } = await supabase
            .from('trackings')
            .select('id, status, metadata')
            .eq('tracking_number', containerNum)
            .eq('organizzazione_id', profile.organizzazione_id)
            .eq('active', true)
            .single();
            
          // Controlla anche se esiste inattivo
          const { data: existingInactive } = await supabase
            .from('trackings')
            .select('id, status, metadata')
            .eq('tracking_number', containerNum)
            .eq('organizzazione_id', profile.organizzazione_id)
            .eq('active', false)
            .single();

          let trackingId;
          
          if (existingActive && skipDuplicates && !updateExisting) {
            stats.skipped++;
            console.log(`Skipped duplicate: ${containerNum}`);
            return;
          }

          if (existingActive && updateExisting) {
            // Aggiorna tracking attivo esistente
            const { error: updateError } = await supabase
              .from('trackings')
              .update({
                ...trackingData,
                metadata: {
                  ...existingActive.metadata,
                  ...metadata,
                  last_csv_update: new Date().toISOString()
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', existingActive.id);

            if (updateError) throw updateError;
            
            trackingId = existingActive.id;
            stats.updated++;
            console.log(`Updated: ${containerNum}`);
            
          } else if (existingInactive) {
            // Riattiva tracking inattivo con TUTTI i nuovi dati
            const { error: reactivateError } = await supabase
              .from('trackings')
              .update({
                ...trackingData,
                active: true,
                status: trackingData.status, // IMPORTANTE: usa il nuovo status dal CSV
                metadata: {
                  ...metadata,
                  reactivated_at: new Date().toISOString(),
                  reactivated_from: 'csv_import'
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', existingInactive.id);

            if (reactivateError) throw reactivateError;
            
            // IMPORTANTE: Rimuovi vecchi eventi DELETED quando riattivi
            await supabase
              .from('tracking_events')
              .delete()
              .eq('tracking_id', existingInactive.id)
              .eq('event_type', 'DELETED');
            
            trackingId = existingInactive.id;
            stats.imported++; // Conta come nuovo
            console.log(`Reactivated: ${containerNum}`);
            
          } else if (!existingActive && !existingInactive) {
            // Crea nuovo tracking
            const { data: newTracking, error: insertError } = await supabase
              .from('trackings')
              .insert([trackingData])
              .select()
              .single();

            if (insertError) throw insertError;
            
            trackingId = newTracking.id;
            stats.imported++;
            console.log(`Imported: ${containerNum}`);
            
            // NON creare evento REGISTERED per import CSV
            // Gli eventi verranno creati sotto basati sui dati CSV
          }

          // Crea eventi se richiesto e abbiamo un tracking
          if (importEvents && trackingId && row.Status && row.Status !== '-') {
            const events = [];
            
            // Evento basato sullo status corrente
            const statusEvent = STATUS_TO_EVENT_MAPPING[row.Status];
            if (statusEvent) {
              // Determina la data dell'evento
              let eventDate = new Date().toISOString();
              
              if (row.Status === 'Loaded' && loadingDate) {
                eventDate = loadingDate;
              } else if (row.Status === 'Discharged' && dischargeDate) {
                eventDate = dischargeDate;
              } else if (row.Status === 'Delivered' && dischargeDate) {
                // Delivered solitamente qualche giorno dopo discharge
                const deliveryDate = new Date(dischargeDate);
                deliveryDate.setDate(deliveryDate.getDate() + 2);
                eventDate = deliveryDate.toISOString();
              }

              events.push({
                tracking_id: trackingId,
                event_date: eventDate,
                event_type: statusEvent.type,
                event_code: statusEvent.code,
                description: statusEvent.description,
                location_name: row.Status.includes('Load') ? 
                  extractPortName(row['Port Of Loading']) : 
                  extractPortName(row['Port Of Discharge']),
                location_code: row.Status.includes('Load') ? 
                  extractPortCode(row['Port Of Loading']) : 
                  extractPortCode(row['Port Of Discharge']),
                data_source: 'shipsgo_csv',
                confidence_score: 0.9,
                raw_data: { csv_row: row }
              });
            }

            // Aggiungi eventi di loading/discharge se abbiamo le date
            if (loadingDate && new Date(loadingDate) < new Date()) {
              events.push({
                tracking_id: trackingId,
                event_date: loadingDate,
                event_type: 'LOADED_ON_VESSEL',
                event_code: 'LOD',
                description: 'Container loaded on vessel',
                location_name: extractPortName(row['Port Of Loading']),
                location_code: extractPortCode(row['Port Of Loading']),
                data_source: 'shipsgo_csv',
                confidence_score: 0.95
              });
            }

            if (dischargeDate && new Date(dischargeDate) < new Date()) {
              events.push({
                tracking_id: trackingId,
                event_date: dischargeDate,
                event_type: 'DISCHARGED_FROM_VESSEL', 
                event_code: 'DIS',
                description: 'Container discharged from vessel',
                location_name: extractPortName(row['Port Of Discharge']),
                location_code: extractPortCode(row['Port Of Discharge']),
                data_source: 'shipsgo_csv',
                confidence_score: 0.95
              });
            }

            if (events.length > 0) {
              // Rimuovi duplicati per tracking_id + event_type + event_date
              const uniqueEvents = [];
              const eventKeys = new Set();
              
              for (const event of events) {
                const key = `${event.tracking_id}-${event.event_type}-${event.event_date}`;
                if (!eventKeys.has(key)) {
                  eventKeys.add(key);
                  uniqueEvents.push(event);
                }
              }

              // Inserisci eventi
              const { error: eventsError } = await supabase
                .from('tracking_events')
                .insert(uniqueEvents);

              if (eventsError) {
                console.error('Error creating events:', eventsError);
              } else {
                stats.events_created += uniqueEvents.length;
              }

              // Aggiorna il tracking con l'ultimo evento
              const lastEvent = uniqueEvents.sort((a, b) => 
                new Date(b.event_date) - new Date(a.event_date)
              )[0];

              if (lastEvent) {
                await supabase
                  .from('trackings')
                  .update({
                    last_event_date: lastEvent.event_date,
                    last_event_location: lastEvent.location_name,
                    last_event_description: lastEvent.description,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', trackingId);
              }
            }
          }

        } catch (error) {
          console.error(`Error processing row ${rowIndex}:`, error);
          console.error('Full error details:', {
            row: row,
            error: error.message,
            stack: error.stack
          });
          stats.errors++;
          errors.push({
            row: rowIndex,
            container: row.Container || 'UNKNOWN',
            error: error.message,
            details: error.response?.data || error.stack
          });
        }
      }));

      // Piccola pausa tra batch per non sovraccaricare
      if (i + batchSize < rows.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Prepara response
    const response = {
      success: true,
      stats: stats,
      message: `Import completato: ${stats.imported} nuovi, ${stats.updated} aggiornati, ${stats.skipped} saltati, ${stats.errors} errori`,
      errors: errors.length > 0 ? errors.slice(0, 10) : [] // Ritorna max 10 errori
    };

    if (stats.events_created > 0) {
      response.message += `, ${stats.events_created} eventi creati`;
    }

    console.log('Import completed:', stats);

    return {
      statusCode: 200,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      })
    };
  }
};
