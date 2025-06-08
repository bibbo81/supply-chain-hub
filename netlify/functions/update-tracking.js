// netlify/functions/update-tracking.js
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { updateTrackingStatusFromAPI } = require('./utils/status-mapping');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// NOTE: The new logic assumes these functions are defined elsewhere.
// You will need to provide their implementation.
async function fetchContainerInfo(trackingNumber) {
  // Placeholder for your container fetching logic
  console.log(`Fetching container info for: ${trackingNumber}`);
  // Example: return await someAPICall(trackingNumber);
  return null; 
}

async function fetchAWBInfo(trackingNumber) {
  // Placeholder for your AWB fetching logic
  console.log(`Fetching AWB info for: ${trackingNumber}`);
  // Example: return await anotherAPICall(trackingNumber);
  return null;
}

async function fetchParcelInfo(trackingNumber, carrierCode) {
  // Placeholder for your parcel fetching logic
  console.log(`Fetching parcel info for: ${trackingNumber} with ${carrierCode}`);
  // Example: return await parcelAPICall(trackingNumber, carrierCode);
  return null;
}


exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let tracking; // Define tracking here to be accessible in the final catch block

  try {
    // Get auth token from header
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    // Verify user from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Get user's organization
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.organizzazione_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    // Parse request body
    const { trackingId, forceUpdate } = JSON.parse(event.body);
    
    if (!trackingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tracking ID' })
      };
    }

    // Get tracking from database
    const { data: trackingData, error: trackingError } = await supabase
      .from('trackings')
      .select('*')
      .eq('id', trackingId)
      .eq('organizzazione_id', profile.organizzazione_id)
      .single();
    
    tracking = trackingData; // Assign to the outer scope variable

    if (trackingError || !tracking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tracking not found' })
      };
    }
    
    // --- CHECKS TO PREVENT UNNECESSARY UPDATES ---
    
    const lastUpdate = tracking.metadata?.last_api_update;
    const minutesSinceUpdate = lastUpdate ?
      (Date.now() - new Date(lastUpdate).getTime()) / 60000 : 999;

    if (minutesSinceUpdate < 15 && !forceUpdate) {
      console.log(`[Skip Update] ${tracking.tracking_number} - Updated ${minutesSinceUpdate.toFixed(0)} minutes ago`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Recently updated, skipped',
          skipped: true
        })
      };
    }

    if (tracking.status === 'delivered' && !forceUpdate) {
      console.log(`[Skip Update] ${tracking.tracking_number} - Already delivered`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Already delivered, skipped',
          skipped: true
        })
      };
    }

    // --- LOGIC FOR UPDATING STATUS FROM API ---

    let updatedTrackingData;
    let updateError;

    // Per Container (ShipsGo V1.2)
    if (tracking.tracking_type === 'container') {
      const containerInfo = await fetchContainerInfo(tracking.tracking_number);
      
      if (containerInfo) {
        const newStatus = await updateTrackingStatusFromAPI(tracking, containerInfo);
        
        console.log(`[Update Tracking] ${tracking.tracking_number}:\n  Old Status: ${tracking.status}\n  New Status: ${newStatus}\n  Source: ${tracking.tracking_type} API\n  Time: ${new Date().toISOString()}`);

        const updateData = {
          status: newStatus,
          last_event_location: containerInfo.Container?.LastLocationName,
          last_event_date: containerInfo.Container?.LastMovementDate,
          vessel_name: containerInfo.Container?.VesselName,
          voyage_number: containerInfo.Container?.VoyageNumber,
          metadata: { ...tracking.metadata, last_api_update: new Date().toISOString(), shipsgo_data: containerInfo.Container }
        };

        if (tracking.status !== newStatus) {
          const statusToEventType = { 'out_for_delivery': 'OUT_FOR_DELIVERY', 'delivered': 'DELIVERED', 'exception': 'EXCEPTION', 'delayed': 'DELAYED', 'cancelled': 'CANCELLED' };
          if (statusToEventType[newStatus]) {
            await supabase.from('tracking_events').insert([{ tracking_id: tracking.id, event_date: new Date().toISOString(), event_type: statusToEventType[newStatus], event_code: newStatus.toUpperCase().substring(0, 3), description: `Status updated to ${newStatus}`, location_name: updateData.last_event_location || 'Unknown', data_source: `${tracking.tracking_type}_api`, confidence_score: 1.0, raw_data: { api_response: containerInfo, previous_status: tracking.status } }]);
          }
        }
        
        const { data, error } = await supabase.from('trackings').update(updateData).eq('id', tracking.id).select().single();
        updatedTrackingData = data;
        updateError = error;
      }
    }
    // Per AWB (ShipsGo V2)
    else if (tracking.tracking_type === 'awb') {
      const awbInfo = await fetchAWBInfo(tracking.tracking_number);
      
      if (awbInfo) {
        const newStatus = await updateTrackingStatusFromAPI(tracking, awbInfo);
        
        console.log(`[Update Tracking] ${tracking.tracking_number}:\n  Old Status: ${tracking.status}\n  New Status: ${newStatus}\n  Source: ${tracking.tracking_type} API\n  Time: ${new Date().toISOString()}`);

        const updateData = {
          status: newStatus,
          eta: awbInfo.estimated_arrival,
          ata: awbInfo.actual_arrival,
          metadata: { ...tracking.metadata, last_api_update: new Date().toISOString(), shipsgo_v2_data: awbInfo }
        };

        if (tracking.status !== newStatus) {
            const statusToEventType = { 'out_for_delivery': 'OUT_FOR_DELIVERY', 'delivered': 'DELIVERED', 'exception': 'EXCEPTION', 'delayed': 'DELAYED', 'cancelled': 'CANCELLED' };
            if (statusToEventType[newStatus]) {
                await supabase.from('tracking_events').insert([{ tracking_id: tracking.id, event_date: new Date().toISOString(), event_type: statusToEventType[newStatus], event_code: newStatus.toUpperCase().substring(0, 3), description: `Status updated to ${newStatus}`, location_name: 'Unknown', data_source: `${tracking.tracking_type}_api`, confidence_score: 1.0, raw_data: { api_response: awbInfo, previous_status: tracking.status } }]);
            }
        }
        
        const { data, error } = await supabase.from('trackings').update(updateData).eq('id', tracking.id).select().single();
        updatedTrackingData = data;
        updateError = error;
      }
    }
    // Per Parcel (DHL/FedEx/UPS)
    else if (tracking.tracking_type === 'parcel') {
      const parcelInfo = await fetchParcelInfo(tracking.tracking_number, tracking.carrier_code);
      
      if (parcelInfo) {
        const newStatus = await updateTrackingStatusFromAPI(tracking, parcelInfo);
        
        console.log(`[Update Tracking] ${tracking.tracking_number}:\n  Old Status: ${tracking.status}\n  New Status: ${newStatus}\n  Source: ${tracking.tracking_type} API\n  Time: ${new Date().toISOString()}`);

        const updateData = {
          status: newStatus,
          last_event_location: parcelInfo.lastLocation,
          last_event_date: parcelInfo.lastUpdate,
          metadata: { ...tracking.metadata, last_api_update: new Date().toISOString(), parcel_data: parcelInfo }
        };
        
        if (tracking.status !== newStatus) {
            const statusToEventType = { 'out_for_delivery': 'OUT_FOR_DELIVERY', 'delivered': 'DELIVERED', 'exception': 'EXCEPTION', 'delayed': 'DELAYED', 'cancelled': 'CANCELLED' };
            if (statusToEventType[newStatus]) {
                await supabase.from('tracking_events').insert([{ tracking_id: tracking.id, event_date: new Date().toISOString(), event_type: statusToEventType[newStatus], event_code: newStatus.toUpperCase().substring(0, 3), description: `Status updated to ${newStatus}`, location_name: updateData.last_event_location || 'Unknown', data_source: `${tracking.tracking_type}_api`, confidence_score: 1.0, raw_data: { api_response: parcelInfo, previous_status: tracking.status } }]);
            }
        }

        const { data, error } = await supabase.from('trackings').update(updateData).eq('id', tracking.id).select().single();
        updatedTrackingData = data;
        updateError = error;
      }
    }

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: updatedTrackingData || tracking,
      })
    };

  } catch (error) {
    console.error(`[Update Error] ${tracking?.tracking_number || 'N/A'}:`, error);
    
    if (tracking) {
      await supabase
        .from('trackings')
        .update({
          metadata: {
            ...tracking.metadata,
            last_api_error: {
              timestamp: new Date().toISOString(),
              error: error.message,
              type: tracking.tracking_type
            }
          }
        })
        .eq('id', tracking.id);
    }
      
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
