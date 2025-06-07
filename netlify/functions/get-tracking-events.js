// netlify/functions/get-tracking-events.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get auth token
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' })
      };
    }

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid token' })
      };
    }

    // Get tracking ID from query
    const { trackingId } = event.queryStringParameters || {};
    if (!trackingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tracking ID' })
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

    // Get tracking details
    const { data: tracking, error: trackingError } = await supabase
      .from('trackings')
      .select('*')
      .eq('id', trackingId)
      .eq('organizzazione_id', profile.organizzazione_id)
      .eq('active', true)
      .single();

    if (trackingError || !tracking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tracking not found' })
      };
    }

    // Get events - ESCLUDI EVENTI DELETED
    const { data: events, error: eventsError } = await supabase
      .from('tracking_events')
      .select('*')
      .eq('tracking_id', trackingId)
      .neq('event_type', 'DELETED') // Exclude DELETED events
      .order('event_date', { ascending: false });

    if (eventsError) {
      console.error('Events error:', eventsError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        tracking,
        events: events || []
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
