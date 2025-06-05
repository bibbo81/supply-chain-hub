// netlify/functions/get-trackings.js
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
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

    // Parse query parameters
    const params = event.queryStringParameters || {};
    const {
      status,
      type,
      carrier,
      search,
      page = 1,
      limit = 50,
      sort = 'created_at',
      order = 'desc'
    } = params;

    // Build query
    let query = supabase
      .from('trackings')
      .select(`
        *,
        latest_event:tracking_events(
          event_date,
          event_type,
          location_name,
          description
        )
      `, { count: 'exact' })
      .eq('organizzazione_id', profile.organizzazione_id)
      .eq('active', true);

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }
    if (type) {
      query = query.eq('tracking_type', type);
    }
    if (carrier) {
      query = query.eq('carrier_code', carrier);
    }
    if (search) {
      query = query.or(`tracking_number.ilike.%${search}%,reference_number.ilike.%${search}%`);
    }

    // Apply sorting
    query = query.order(sort, { ascending: order === 'asc' });

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    // Execute query
    const { data: trackings, error: queryError, count } = await query;

    if (queryError) {
      console.error('Query error:', queryError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch trackings' })
      };
    }

    // Get latest event for each tracking
    const trackingIds = trackings.map(t => t.id);
    const { data: latestEvents } = await supabase
      .from('tracking_events')
      .select('*')
      .in('tracking_id', trackingIds)
      .order('event_date', { ascending: false });

    // Group events by tracking_id and get the latest
    const eventMap = {};
    if (latestEvents) {
      latestEvents.forEach(event => {
        if (!eventMap[event.tracking_id]) {
          eventMap[event.tracking_id] = event;
        }
      });
    }

    // Merge latest events with trackings
    const enrichedTrackings = trackings.map(tracking => ({
      ...tracking,
      latest_event: eventMap[tracking.id] || null
    }));

    // Calculate stats
    const stats = {
      total: count || 0,
      in_transit: trackings.filter(t => t.status === 'in_transit').length,
      delivered: trackings.filter(t => t.status === 'delivered').length,
      delayed: trackings.filter(t => t.status === 'delayed').length
    };

    // Return response
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data: enrichedTrackings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        },
        stats
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