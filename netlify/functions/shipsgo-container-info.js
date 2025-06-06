// netlify/functions/shipsgo-container-info.js
// Recupera informazioni dettagliate di un container già tracciato

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Funzione per ottenere configurazione ShipsGo V1 dinamica
async function getShipsGoV1Config(userId) {
  // Prima prova dalle env variables
  let apiKey = process.env.SHIPSGO_API_KEY;
  
  // Se non c'è, prendi dal profilo utente
  if (!apiKey && userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('api_settings')
      .eq('id', userId)
      .single();
      
    if (profile?.api_settings?.shipsgo_v1_key) {
      apiKey = Buffer.from(profile.api_settings.shipsgo_v1_key, 'base64').toString();
    }
  }
  
  // Fallback alla key di default per retrocompatibilità
  if (!apiKey) {
    apiKey = '2dc0c6d92ccb59e7d903825c4ebeb521';
  }
  
  return {
    baseUrl: 'https://shipsgo.com/api/v1.2',
    authCode: apiKey
  };
}

exports.handler = async (event, context) => {
  // Define CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers, // Add headers
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Verifica autenticazione se presente
    let userId = null;
    const token = event.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (!authError && user) {
        userId = user.id;
      }
    }

    // Ottieni configurazione dinamica
    const SHIPSGO_API = await getShipsGoV1Config(userId);

    // Ottieni parametri dalla query string
    const { containerId, containerNumber } = event.queryStringParameters || {};
    
    if (!containerId && !containerNumber) {
      return {
        statusCode: 400,
        headers, // Add headers
        body: JSON.stringify({ error: 'containerId o containerNumber richiesto' })
      };
    }

    // Costruisci URL per GetContainerInfo
    const url = new URL(`${SHIPSGO_API.baseUrl}/ContainerService/GetContainerInfo/`);
    url.searchParams.append('authCode', SHIPSGO_API.authCode);
    
    // ShipsGo vuole o containerId o containerNumber + shippingLine
    if (containerId) {
      url.searchParams.append('containerId', containerId);
    } else {
      url.searchParams.append('containerNumber', containerNumber);
      // Aggiungi shipping line se fornita
      const { shippingLine } = event.queryStringParameters;
      if (shippingLine) {
        url.searchParams.append('shippingLine', shippingLine);
      }
    }

    console.log('Chiamata ShipsGo:', url.toString());

    // Chiama API ShipsGo
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('ShipsGo error:', data);
      return {
        statusCode: response.status,
        headers, // Add headers
        body: JSON.stringify({ 
          error: 'ShipsGo API error',
          details: data 
        })
      };
    }

    // Trasforma risposta ShipsGo nel nostro formato
    const containerInfo = normalizeShipsGoContainer(data);

    return {
      statusCode: 200,
      headers, // Add headers
      body: JSON.stringify({
        success: true,
        data: containerInfo,
        raw: data // Includi dati raw per debug
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers, // Add headers
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Normalizza dati ShipsGo nel nostro formato
function normalizeShipsGoContainer(shipsgoData) {
  // ShipsGo può restituire un array o un oggetto singolo
  const container = Array.isArray(shipsgoData) ? shipsgoData[0] : shipsgoData;
  
  if (!container) return null;

  // Estrai eventi
  const events = [];
  if (container.containerEvents && Array.isArray(container.containerEvents)) {
    container.containerEvents.forEach(event => {
      events.push({
        event_date: event.eventDate || event.date,
        event_type: mapEventType(event.eventType || event.description),
        event_code: event.eventCode || event.eventType,
        location_name: event.location,
        location_code: event.unLocode,
        description: event.description,
        vessel_name: event.vesselName,
        voyage_number: event.voyageNumber,
        data_source: 'shipsgo_api',
        confidence_score: 1.0
      });
    });
  }

  // Calcola status
  let status = 'registered';
  const lastEvent = events[0];
  if (lastEvent) {
    if (lastEvent.description?.toLowerCase().includes('delivered')) {
      status = 'delivered';
    } else if (lastEvent.description?.toLowerCase().includes('discharged')) {
      status = 'in_transit';
    } else if (lastEvent.description?.toLowerCase().includes('loaded')) {
      status = 'in_transit';
    }
  }

  return {
    tracking_number: container.containerNumber,
    carrier_code: container.shippingLine,
    carrier_name: container.carrierName || container.shippingLine,
    status: status,
    vessel_name: container.currentVessel?.vesselName,
    vessel_imo: container.currentVessel?.imo,
    voyage_number: container.currentVoyage,
    origin_port: container.pol || container.portOfLoading,
    destination_port: container.pod || container.portOfDischarge,
    eta: container.eta,
    ata: container.ata,
    last_event: lastEvent,
    events: events,
    metadata: {
      shipsgo_container_id: container.containerId,
      container_size: container.containerSize,
      container_type: container.containerType,
      bl_number: container.blNumber,
      booking_number: container.bookingNumber,
      last_update: new Date().toISOString()
    }
  };
}

function mapEventType(description) {
  const mapping = {
    'Gate in': 'GATE_IN',
    'Gate out': 'GATE_OUT',
    'Loaded': 'LOADED_ON_VESSEL',
    'Discharged': 'DISCHARGED_FROM_VESSEL',
    'Delivered': 'DELIVERED',
    'Empty': 'EMPTY_RETURNED',
    'On rail': 'ON_RAIL',
    'Off rail': 'OFF_RAIL'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (description?.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  
  return 'OTHER';
}
