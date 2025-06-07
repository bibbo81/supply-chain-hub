// netlify/functions/sync-shipsgo-bulk.js
const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ShipsGo configurations
const SHIPSGO_V2_CONFIG = {
  baseUrl: 'https://api.shipsgo.com/v2',
  headers: (token) => ({
    'X-Shipsgo-User-Token': token,
    'Accept': 'application/json'
  })
};

const SHIPSGO_V1_CONFIG = {
  baseUrl: 'https://shipsgo.com/api/v1.2',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
};

// Helper: chunk array per batch processing
function chunks(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Helper: Delay tra chiamate API
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    // Get user's organization and API settings
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id, api_settings')
      .eq('id', user.id)
      .single();

    if (!profile?.organizzazione_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    // Decode API keys
    let shipsgoV2Token = process.env.SHIPSGO_V2_TOKEN;
    let shipsgoV1Key = process.env.SHIPSGO_V1_API_KEY;
    
    if (profile.api_settings) {
      if (profile.api_settings.shipsgo_v2_token) {
        shipsgoV2Token = Buffer.from(profile.api_settings.shipsgo_v2_token, 'base64').toString();
      }
      if (profile.api_settings.shipsgo_v1_key) {
        shipsgoV1Key = Buffer.from(profile.api_settings.shipsgo_v1_key, 'base64').toString();
      }
    }

    // Parse request
    const { mode, trackingList, options = {} } = JSON.parse(event.body);
    
    const {
      limit = 500,          // Max tracking da sincronizzare
      onlyActive = true,    // Solo tracking attivi
      dateFrom = null,      // Data inizio per filtro
      updateExisting = true // Aggiorna tracking esistenti
    } = options;

    let results = [];
    let errors = [];
    const stats = {
      awb_synced: 0,
      containers_synced: 0,
      events_created: 0,
      errors: 0
    };

    // MODE: AUTO - Sync completo account ShipsGo
    if (mode === 'auto') {
      console.log('Starting auto sync from ShipsGo account...');
      
      // STEP 1: Sync AWB tramite ShipsGo V2 API
      if (shipsgoV2Token) {
        try {
          console.log('Fetching AWB list from ShipsGo V2...');
          
          const params = new URLSearchParams({
            take: Math.min(limit, 200).toString(),
            skip: '0'
          });
          
          if (dateFrom) {
            params.append('created_after', dateFrom);
          }
          
          const awbResponse = await fetch(
            `${SHIPSGO_V2_CONFIG.baseUrl}/air/shipments?${params}`,
            {
              headers: SHIPSGO_V2_CONFIG.headers(shipsgoV2Token)
            }
          );

          if (awbResponse.ok) {
            const awbData = await awbResponse.json();
            const shipments = awbData.data || awbData.shipments || [];
            
            console.log(`Found ${shipments.length} AWB shipments`);
            
            // Processa AWB in batch
            for (const awbBatch of chunks(shipments, 10)) {
              await Promise.all(awbBatch.map(async (shipment) => {
                try {
                  // Controlla se esiste già
                  const { data: existing } = await supabase
                    .from('trackings')
                    .select('id')
                    .eq('tracking_number', shipment.awb_number)
                    .eq('organizzazione_id', profile.organizzazione_id)
                    .single();

                  if (!existing || updateExisting) {
                    const trackingData = {
                      organizzazione_id: profile.organizzazione_id,
                      tracking_number: shipment.awb_number,
                      tracking_type: 'awb',
                      carrier_code: shipment.airline_iata_code,
                      carrier_name: shipment.airline_name,
                      origin_port: shipment.origin_airport_code,
                      origin_name: shipment.origin_airport_name,
                      destination_port: shipment.destination_airport_code,
                      destination_name: shipment.destination_airport_name,
                      status: mapShipsGoStatus(shipment.status),
                      flight_number: shipment.flight_number,
                      eta: shipment.estimated_arrival,
                      ata: shipment.actual_arrival,
                      metadata: {
                        source: 'shipsgo_v2_sync',
                        shipsgo_id: shipment.id,
                        pieces: shipment.pieces,
                        weight: shipment.weight,
                        weight_unit: shipment.weight_unit,
                        last_sync: new Date().toISOString()
                      }
                    };

                    if (existing) {
                      await supabase
                        .from('trackings')
                        .update(trackingData)
                        .eq('id', existing.id);
                    } else {
                      await supabase
                        .from('trackings')
                        .insert([trackingData]);
                    }

                    stats.awb_synced++;
                    results.push({
                      tracking_number: shipment.awb_number,
                      type: 'awb',
                      status: 'synced'
                    });
                  }
                } catch (error) {
                  console.error(`Error syncing AWB ${shipment.awb_number}:`, error);
                  stats.errors++;
                  errors.push({
                    tracking: shipment.awb_number,
                    error: error.message
                  });
                }
              }));
              
              // Rate limiting
              await delay(500);
            }
          } else {
            console.error('Failed to fetch AWB list:', await awbResponse.text());
          }
        } catch (error) {
          console.error('AWB sync error:', error);
        }
      }

      // STEP 2: Per i container, sincronizza quelli locali
      // (V1.2 non ha list endpoint, quindi aggiorniamo solo esistenti)
      if (shipsgoV1Key) {
        console.log('Updating existing containers...');
        
        const { data: localContainers } = await supabase
          .from('trackings')
          .select('id, tracking_number, carrier_code, metadata')
          .eq('organizzazione_id', profile.organizzazione_id)
          .eq('tracking_type', 'container')
          .eq('active', true)
          .limit(limit);

        if (localContainers && localContainers.length > 0) {
          for (const containerBatch of chunks(localContainers, 5)) {
            await Promise.all(containerBatch.map(async (container) => {
              try {
                // GET container info (non consuma crediti)
                const formData = new URLSearchParams();
                formData.append('authCode', shipsgoV1Key);
                formData.append('containerNumber', container.tracking_number);
                
                const response = await fetch(
                  `${SHIPSGO_V1_CONFIG.baseUrl}/containerInfo`,
                  {
                    method: 'POST',
                    headers: SHIPSGO_V1_CONFIG.headers,
                    body: formData.toString()
                  }
                );

                if (response.ok) {
                  const data = await response.json();
                  
                  if (data.Container) {
                    // Aggiorna con info da ShipsGo
                    await supabase
                      .from('trackings')
                      .update({
                        status: mapContainerStatus(data.Container.ContainerState),
                        last_event_location: data.Container.LastLocationName,
                        last_event_date: data.Container.LastMovementDate,
                        vessel_name: data.Container.VesselName,
                        voyage_number: data.Container.VoyageNumber,
                        metadata: {
                          ...container.metadata,
                          shipsgo_container_id: data.Container.Id,
                          last_shipsgo_sync: new Date().toISOString(),
                          shipsgo_data: data.Container
                        },
                        updated_at: new Date().toISOString()
                      })
                      .eq('id', container.id);

                    stats.containers_synced++;
                  }
                }
              } catch (error) {
                console.error(`Error updating container ${container.tracking_number}:`, error);
                stats.errors++;
              }
            }));
            
            await delay(1000); // Rate limiting più conservativo per V1.2
          }
        }
      }
    }
    
    // MODE: BATCH - Import lista specifica di tracking
    else if (mode === 'batch' && trackingList && trackingList.length > 0) {
      console.log(`Processing batch of ${trackingList.length} trackings...`);
      
      for (const trackingBatch of chunks(trackingList, 50)) {
        await Promise.all(trackingBatch.map(async (item) => {
          try {
            const { trackingNumber, trackingType, carrierCode } = item;
            
            // Container - usa V1.2
            if (trackingType === 'container' && shipsgoV1Key) {
              const formData = new URLSearchParams();
              formData.append('authCode', shipsgoV1Key);
              formData.append('containerNumber', trackingNumber);
              formData.append('shippingLine', carrierCode);
              
              // POST per registrare (consuma credito)
              const response = await fetch(
                `${SHIPSGO_V1_CONFIG.baseUrl}/trackContainer`,
                {
                  method: 'POST',
                  headers: SHIPSGO_V1_CONFIG.headers,
                  body: formData.toString()
                }
              );
              
              if (response.ok) {
                stats.containers_synced++;
                results.push({
                  tracking_number: trackingNumber,
                  type: 'container',
                  status: 'registered'
                });
              }
            }
            
            // AWB - usa V2
            else if (trackingType === 'awb' && shipsgoV2Token) {
              const response = await fetch(
                `${SHIPSGO_V2_CONFIG.baseUrl}/air/trackings`,
                {
                  method: 'POST',
                  headers: {
                    ...SHIPSGO_V2_CONFIG.headers(shipsgoV2Token),
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    awb_number: trackingNumber,
                    airline_iata_code: carrierCode
                  })
                }
              );
              
              if (response.ok) {
                stats.awb_synced++;
                results.push({
                  tracking_number: trackingNumber,
                  type: 'awb',
                  status: 'registered'
                });
              }
            }
          } catch (error) {
            console.error(`Error processing ${item.trackingNumber}:`, error);
            stats.errors++;
            errors.push({
              tracking: item.trackingNumber,
              error: error.message
            });
          }
        }));
        
        await delay(500);
      }
    }

    // Prepara risposta
    const message = mode === 'auto' 
      ? `Sync account completato: ${stats.awb_synced} AWB, ${stats.containers_synced} container aggiornati`
      : `Batch import completato: ${results.length} tracking processati`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        mode: mode,
        stats: stats,
        message: message,
        results: results.slice(0, 100), // Limita risultati nella response
        errors: errors.slice(0, 10)      // Limita errori nella response
      })
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

// Helper: Map ShipsGo status to our status
function mapShipsGoStatus(shipsgoStatus) {
  const mapping = {
    'DELIVERED': 'delivered',
    'IN_TRANSIT': 'in_transit',
    'DEPARTED': 'in_transit',
    'ARRIVED': 'in_transit',
    'REGISTERED': 'registered',
    'PENDING': 'registered'
  };
  
  return mapping[shipsgoStatus] || 'registered';
}

function mapContainerStatus(containerState) {
  const stateMapping = {
    'Full': 'in_transit',
    'Empty': 'delivered',
    'Unknown': 'registered'
  };
  
  return stateMapping[containerState] || 'in_transit';
}