// netlify/functions/api-integration.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'CORS OK' }) };
  }

  try {
    const { httpMethod, body } = event;
    const parsedBody = body ? JSON.parse(body) : {};

    switch (httpMethod) {
      case 'GET':
        return await handleGetRequest(event.queryStringParameters);
      case 'POST':
        return await handlePostRequest(parsedBody);
      default:
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
  } catch (error) {
    console.error('API Integration Error:', error);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
};

async function handleGetRequest(params) {
  const { action } = params || {};
  
  switch (action) {
    case 'get_config':
      return await getApiConfig();
    case 'track-container':
      return await trackContainer(params.containerId);
    case 'get-air-shipments':
      return await getAirShipments();
    case 'get-parcel-deliveries':
      return await getParcelDeliveries();
    default:
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid action' }) };
  }
}

async function handlePostRequest(data) {
  const { action } = data;
  
  switch (action) {
    case 'get_config':
      return await getApiConfig();
    case 'update_config':
      return await updateApiConfig(data);
    case 'test_connection':
      return await testConnection(data.provider);
    case 'track_shipment':
      return await trackShipment(data);
    case 'sync-container':
      return await syncContainerData(data);
    case 'sync-air-shipments':
      return await syncAirShipments();
    case 'sync-parcel-deliveries':
      return await syncParcelDeliveries();
    case 'create-from-tracking':
      return await createShipmentFromTracking(data);
    default:
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid action' }) };
  }
}

// API Configuration Management
async function getApiConfig() {
  try {
    const { data, error } = await supabase
      .from('api_config')
      .select('*');

    if (error) throw error;

    const config = {};
    data.forEach(item => {
      config[item.provider] = {
        auth_code: item.auth_code,
        auth_token: item.auth_token,
        api_key: item.api_key,
        base_url: item.base_url,
        is_active: item.is_active
      };
    });

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, data: config }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}

async function updateApiConfig(data) {
  try {
    const { provider, config } = data;
    
    const { error } = await supabase
      .from('api_config')
      .upsert({
        provider,
        ...config,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}

// Connection Testing
async function testConnection(provider) {
  try {
    let testResult;
    
    switch(provider) {
      case 'shipsgo_container':
        testResult = await trackContainer('TEST123456');
        break;
      case 'shipsgo_air':
        testResult = await getAirShipments();
        break;
      case 'parcel_app':
        testResult = await getParcelDeliveries();
        break;
      default:
        throw new Error(`Provider ${provider} not supported`);
    }
    
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, data: testResult }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: error.message }) };
  }
}

// ShipsGo Container API Integration
async function trackContainer(containerId) {
  try {
    const { data: config } = await supabase
      .from('api_config')
      .select('*')
      .eq('provider', 'shipsgo_container')
      .single();
    
    const authCode = config?.auth_code || '2dc0c6d92ccb59e7d903825c4ebeb521';
    
    const response = await fetch(`https://shipsgo.com/api/v1.2/ContainerService/GetContainerInfo/?authCode=${authCode}&requestId=${containerId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Supply-Chain-Hub/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`ShipsGo API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      tracking_number: containerId,
      status: data.status || 'Unknown',
      carrier: data.carrier || 'ShipsGo',
      origin: data.pol || 'N/A',
      destination: data.pod || 'N/A',
      ship_date: data.shipDate,
      eta: data.eta,
      api_source: 'shipsgo_container',
      raw_data: data
    };
    
  } catch (error) {
    throw new Error(`Container tracking failed: ${error.message}`);
  }
}

// ShipsGo Air API Integration
async function getAirShipments() {
  try {
    const { data: config } = await supabase
      .from('api_config')
      .select('*')
      .eq('provider', 'shipsgo_air')
      .single();
    
    const authToken = config?.auth_token || '505751c2-2745-4d83-b4e7-d35ccddd0628';
    
    const response = await fetch('https://api.shipsgo.com/v2/air/shipments', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`ShipsGo Air API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    throw new Error(`Air shipments fetch failed: ${error.message}`);
  }
}

async function syncAirShipments() {
  try {
    const shipments = await getAirShipments();
    let syncedCount = 0;
    
    for (const shipment of shipments.data || []) {
      const { error } = await supabase
        .from('shipments')
        .upsert({
          awb_number: shipment.awb,
          tracking_number: shipment.tracking_number,
          status: shipment.status,
          carrier: shipment.airline,
          origin: shipment.origin_airport,
          destination: shipment.destination_airport,
          ship_date: shipment.departure_date,
          eta: shipment.arrival_date,
          created_by_api: true,
          api_source: 'shipsgo_air',
          external_id: shipment.id
        });
      
      if (!error) syncedCount++;
    }
    
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, synced: syncedCount }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}

// Parcel App API Integration
async function getParcelDeliveries() {
  try {
    const { data: config } = await supabase
      .from('api_config')
      .select('*')
      .eq('provider', 'parcel_app')
      .single();
    
    const apiKey = config?.api_key || '_vnMaCsRMjuWOZwTfwgAW7u0iRk03XfTEuO3QLYNWfdgwhAEbQbXoyTeWAdkzFAcrsDqBsE5Ula';
    
    const response = await fetch('https://api.parcel.app/external/deliveries/', {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Parcel App API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
    
  } catch (error) {
    throw new Error(`Parcel deliveries fetch failed: ${error.message}`);
  }
}

async function syncParcelDeliveries() {
  try {
    const deliveries = await getParcelDeliveries();
    let syncedCount = 0;
    
    for (const delivery of deliveries.results || []) {
      const { error } = await supabase
        .from('shipments')
        .upsert({
          tracking_number: delivery.tracking_number,
          status: delivery.status,
          carrier: delivery.carrier,
          origin: delivery.origin,
          destination: delivery.destination,
          ship_date: delivery.created_at,
          eta: delivery.estimated_delivery,
          created_by_api: true,
          api_source: 'parcel_app',
          external_id: delivery.id
        });
      
      if (!error) syncedCount++;
    }
    
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, synced: syncedCount }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}

// Generic shipment tracking
async function trackShipment(data) {
  try {
    const { tracking_number, provider } = data;
    let result;
    
    if (!provider || provider === 'auto') {
      // Auto-detect based on tracking number format
      if (tracking_number.length >= 10 && tracking_number.length <= 15) {
        result = await trackContainer(tracking_number);
      }
    } else {
      switch(provider) {
        case 'shipsgo_container':
          result = await trackContainer(tracking_number);
          break;
        case 'shipsgo_air':
          // Implement air tracking by AWB
          result = await trackAirShipment(tracking_number);
          break;
        case 'parcel_app':
          // Implement parcel tracking
          result = await trackParcel(tracking_number);
          break;
        default:
          throw new Error(`Provider ${provider} not supported`);
      }
    }
    
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, data: result }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ success: false, error: error.message }) };
  }
}

// Create shipment from tracking data
async function createShipmentFromTracking(data) {
  try {
    const { trackingNumber, provider } = data;
    
    // First track the shipment
    const trackingData = await trackShipment({ tracking_number: trackingNumber, provider });
    
    if (!trackingData.success) {
      throw new Error('Failed to track shipment');
    }
    
    // Create shipment in database
    const { error } = await supabase
      .from('shipments')
      .insert({
        ...trackingData.data,
        created_by_api: true,
        created_at: new Date().toISOString()
      });
    
    if (error) throw error;
    
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}

// Helper functions for specific tracking methods
async function trackAirShipment(awb) {
  // Implementation for air shipment tracking by AWB
  const shipments = await getAirShipments();
  const shipment = shipments.data?.find(s => s.awb === awb || s.tracking_number === awb);
  
  if (!shipment) {
    throw new Error('Air shipment not found');
  }
  
  return {
    tracking_number: shipment.awb,
    status: shipment.status,
    carrier: shipment.airline,
    origin: shipment.origin_airport,
    destination: shipment.destination_airport,
    ship_date: shipment.departure_date,
    eta: shipment.arrival_date,
    api_source: 'shipsgo_air'
  };
}

async function trackParcel(trackingNumber) {
  // Implementation for parcel tracking
  const deliveries = await getParcelDeliveries();
  const delivery = deliveries.results?.find(d => d.tracking_number === trackingNumber);
  
  if (!delivery) {
    throw new Error('Parcel not found');
  }
  
  return {
    tracking_number: delivery.tracking_number,
    status: delivery.status,
    carrier: delivery.carrier,
    origin: delivery.origin,
    destination: delivery.destination,
    ship_date: delivery.created_at,
    eta: delivery.estimated_delivery,
    api_source: 'parcel_app'
  };
}

// Container sync function
async function syncContainerData(data) {
  try {
    const { containerId } = data;
    const containerData = await trackContainer(containerId);
    
    const { error } = await supabase
      .from('shipments')
      .upsert({
        container_number: containerId,
        tracking_number: containerId,
        status: containerData.status,
        carrier: containerData.carrier,
        origin: containerData.origin,
        destination: containerData.destination,
        ship_date: containerData.ship_date,
        eta: containerData.eta,
        created_by_api: true,
        api_source: 'shipsgo_container',
        external_id: containerId
      });
    
    if (error) throw error;
    
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, data: containerData }) };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
