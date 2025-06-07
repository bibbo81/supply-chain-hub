// netlify/functions/create-tracking-events.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    // Parse request
    const { trackingId, events, updateTracking = false } = JSON.parse(event.body);

    if (!trackingId || !events || !Array.isArray(events)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'trackingId and events array required' })
      };
    }

    // Verifica che il tracking appartenga all'utente
    const { data: tracking, error: trackingError } = await supabase
      .from('trackings')
      .select('id, organizzazione_id')
      .eq('id', trackingId)
      .single();

    if (trackingError || !tracking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tracking not found' })
      };
    }

    // Verifica organizzazione
    const { data: profile } = await supabase
      .from('profiles')
      .select('organizzazione_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.organizzazione_id !== tracking.organizzazione_id) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Prepara eventi con tracking_id
    const eventsToInsert = events.map(event => ({
      tracking_id: trackingId,
      event_date: event.event_date || new Date().toISOString(),
      event_type: event.event_type,
      event_code: event.event_code,
      location_name: event.location_name,
      location_code: event.location_code,
      description: event.description,
      vessel_name: event.vessel_name,
      vessel_imo: event.vessel_imo,
      voyage_number: event.voyage_number,
      data_source: event.data_source || 'manual',
      confidence_score: event.confidence_score || 1.0,
      raw_data: event.raw_data || {}
    }));

    // Inserisci eventi
    const { data: insertedEvents, error: insertError } = await supabase
      .from('tracking_events')
      .insert(eventsToInsert)
      .select();

    if (insertError) {
      console.error('Error inserting events:', insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create events' })
      };
    }

    // Se richiesto, aggiorna il tracking con l'ultimo evento
    if (updateTracking && insertedEvents.length > 0) {
      // Trova l'evento più recente
      const latestEvent = insertedEvents.reduce((latest, event) => {
        return new Date(event.event_date) > new Date(latest.event_date) ? event : latest;
      });

      // Determina nuovo status basato sul tipo di evento
      let newStatus = null;
      if (latestEvent.event_type === 'DELIVERED' || latestEvent.event_type === 'EMPTY_RETURNED') {
        newStatus = 'delivered';
      } else if (['LOADED_ON_VESSEL', 'DISCHARGED_FROM_VESSEL', 'DEPARTED', 'ARRIVED'].includes(latestEvent.event_type)) {
        newStatus = 'in_transit';
      }

      const updateData = {
        last_event_date: latestEvent.event_date,
        last_event_location: latestEvent.location_name,
        last_event_description: latestEvent.description,
        updated_at: new Date().toISOString()
      };

      if (newStatus) {
        updateData.status = newStatus;
      }

      const { error: updateError } = await supabase
        .from('trackings')
        .update(updateData)
        .eq('id', trackingId);

      if (updateError) {
        console.error('Error updating tracking:', updateError);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: {
          events_added: insertedEvents.length,
          tracking_updated: updateTracking
        }
      })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};