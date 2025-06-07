// netlify/functions/shipsgo-air-shipments.js
// Recupera lista spedizioni aeree da ShipsGo v2

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Funzione per ottenere configurazione ShipsGo V2 dinamica
async function getShipsGoV2Config(userId) {
  // Prima prova dalle env variables
  let authToken = process.env.SHIPSGO_V2_TOKEN;
  
  // Se non c'è, prendi dal profilo utente
  if (!authToken && userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('api_settings')
      .eq('id', userId)
      .single();
      
    if (profile?.api_settings?.shipsgo_v2_token) {
      authToken = Buffer.from(profile.api_settings.shipsgo_v2_token, 'base64').toString();
    }
  }
  
  // Fallback al token di default per retrocompatibilità
  if (!authToken) {
    authToken = '505751c2-2745-4d83-b4e7-d35ccddd0628';
  }
  
  return {
    baseUrl: 'https://api.shipsgo.com/v2',
    authToken: authToken
  };
}

exports.handler = async (event, context) => {
  // Definisci gli header CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Gestisci la richiesta preflight OPTIONS per CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Preflight call successful' })
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Verifica autenticazione
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Ottieni configurazione dinamica
    const SHIPSGO_V2_API = await getShipsGoV2Config(user.id);

    // Parametri query
    const {
      field,           // Campo per filtro (es: awb_number, airline_code)
      filter_value,    // Valore del filtro
      order_by = 'created_at',
      skip = 0,
      take = 50
    } = event.queryStringParameters || {};

    // Costruisci URL
    const url = new URL(`${SHIPSGO_V2_API.baseUrl}/air/shipments`);
    
    // Aggiungi filtri se presenti
    if (field && filter_value) {
      url.searchParams.append('filters[field]', field);
      url.searchParams.append('filters[value]', filter_value);
    }
    
    url.searchParams.append('order_by', order_by);
    url.searchParams.append('skip', skip);
    url.searchParams.append('take', take);

    console.log('ShipsGo Air API call:', url.toString());

    // Chiamata API
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Shipsgo-User-Token': SHIPSGO_V2_API.authToken,  // ✅ CORRETTO
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('ShipsGo v2 error:', data);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ 
          error: 'ShipsGo API error',
          details: data 
        })
      };
    }

    // Normalizza dati per il nostro sistema
    const normalizedShipments = data.data?.map(shipment => normalizeAirShipment(shipment)) || [];

    // Opzionale: sincronizza con il nostro DB
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (profile?.organizzazione_id) {
      // Aggiorna tracking locali con dati ShipsGo
      for (const shipment of normalizedShipments) {
        await syncAirShipmentToLocal(shipment, profile.organizzazione_id, user.email);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: normalizedShipments,
        pagination: {
          skip: parseInt(skip),
          take: parseInt(take),
          total: data.total || normalizedShipments.length
        },
        raw: data // Include raw data per debug
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Normalizza shipment aereo ShipsGo nel nostro formato
function normalizeAirShipment(shipment) {
  // Estrai ultimo evento
  const events = shipment.tracking_history || [];
  const lastEvent = events[0];
  
  // Determina status
  let status = 'registered';
  if (shipment.status) {
    if (shipment.status.toLowerCase().includes('delivered')) {
      status = 'delivered';
    } else if (shipment.status.toLowerCase().includes('transit')) {
      status = 'in_transit';
    }
  }

  return {
    tracking_number: shipment.awb_number,
    tracking_type: 'awb',
    carrier_code: shipment.airline_code,
    carrier_name: shipment.airline_name || shipment.airline_code,
    status: status,
    origin_airport: shipment.origin_airport,
    destination_airport: shipment.destination_airport,
    flight_number: shipment.flight_number,
    eta: shipment.estimated_delivery,
    ata: shipment.actual_delivery,
    last_event: lastEvent ? {
      date: lastEvent.event_date,
      location: lastEvent.location,
      description: lastEvent.description,
      code: lastEvent.event_code
    } : null,
    metadata: {
      shipsgo_shipment_id: shipment.id,
      shipsgo_tracking_id: shipment.tracking_id,
      pieces: shipment.pieces,
      weight: shipment.weight,
      weight_unit: shipment.weight_unit,
      shipper: shipment.shipper,
      consignee: shipment.consignee,
      created_at: shipment.created_at,
      updated_at: shipment.updated_at
    }
  };
}

// Sincronizza con tracking locale
async function syncAirShipmentToLocal(shipment, organizationId, userEmail) {
  try {
    const trackingData = {
      organizzazione_id: organizationId,
      tracking_number: shipment.tracking_number,
      tracking_type: shipment.tracking_type,
      carrier_code: shipment.carrier_code,
      carrier_name: shipment.carrier_name,
      status: shipment.status,
      origin_port: shipment.origin_airport,
      destination_port: shipment.destination_airport,
      eta: shipment.eta,
      ata: shipment.ata,
      flight_number: shipment.flight_number,
      last_event_date: shipment.last_event?.date,
      last_event_location: shipment.last_event?.location,
      last_event_description: shipment.last_event?.description,
      active: true,
      metadata: {
        ...shipment.metadata,
        synced_from_shipsgo: true,
        synced_at: new Date().toISOString(),
        synced_by: userEmail
      }
    };

    const { error } = await supabase
      .from('trackings')
      .upsert(trackingData, {
        onConflict: 'tracking_number,organizzazione_id'
      });

    if (error) {
      console.error('Sync error for', shipment.tracking_number, error);
    }
  } catch (error) {
    console.error('Sync failed:', error);
  }
}
