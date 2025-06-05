// netlify/functions/webhook-tracking.js
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verify webhook signature (if ShipsGo provides one)
function verifySignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return hash === signature;
}

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse webhook payload
    const payload = JSON.parse(event.body);
    
    // Verify signature if provided
    const signature = event.headers['x-shipsgo-signature'];
    if (signature && process.env.SHIPSGO_WEBHOOK_SECRET) {
      const isValid = verifySignature(
        event.body, 
        signature, 
        process.env.SHIPSGO_WEBHOOK_SECRET
      );
      
      if (!isValid) {
        return {
          statusCode: 401,
          body: JSON.stringify({ error: 'Invalid signature' })
        };
      }
    }

    // Extract event data
    const {
      containerId,
      trackingNumber,
      eventType,
      eventDate,
      location,
      vessel,
      status
    } = payload;

    // Find tracking by container ID or tracking number
    let query = supabase
      .from('trackings')
      .select('*')
      .eq('active', true);

    if (containerId) {
      query = query.eq('metadata->shipsgo_container_id', containerId);
    } else if (trackingNumber) {
      query = query.eq('tracking_number', trackingNumber);
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No identifier provided' })
      };
    }

    const { data: tracking, error: trackingError } = await query.single();

    if (trackingError || !tracking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tracking not found' })
      };
    }

    // Insert event
    const { error: eventError } = await supabase
      .from('tracking_events')
      .insert({
        tracking_id: tracking.id,
        event_date: new Date(eventDate).toISOString(),
        event_type: eventType || 'OTHER',
        event_code: eventType,
        location_name: location?.name,
        location_code: location?.code,
        description: payload.description || eventType,
        vessel_name: vessel?.name,
        vessel_imo: vessel?.imo,
        voyage_number: vessel?.voyage,
        data_source: 'shipsgo_webhook',
        confidence_score: 1.0,
        raw_data: payload
      });

    if (eventError) {
      console.error('Event insert error:', eventError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save event' })
      };
    }

    // Update tracking status
    const updateData = {
      status: status || tracking.status,
      last_event_date: new Date(eventDate).toISOString(),
      last_event_location: location?.name,
      last_event_description: payload.description || eventType,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('trackings')
      .update(updateData)
      .eq('id', tracking.id);

    if (updateError) {
      console.error('Update error:', updateError);
    }

    // TODO: Trigger notifications if needed
    // if (eventType === 'DELIVERED' || eventType === 'DELAYED') {
    //   await sendNotification(tracking, eventType);
    // }

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: 'Webhook processed successfully'
      })
    };

  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};