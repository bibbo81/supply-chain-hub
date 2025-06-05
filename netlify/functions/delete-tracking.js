// netlify/functions/delete-tracking.js
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ShipsGo configurations
const SHIPSGO_V1_CONFIG = {
  baseUrl: 'https://shipsgo.com/api/v1.2',
  apiKey: process.env.SHIPSGO_V1_API_KEY || '2dc0c6d92ccb59e7d903825c4ebeb521',
  headers: {
    'Authorization': 'Bearer 2dc0c6d92ccb59e7d903825c4ebeb521',
    'Content-Type': 'application/json'
  }
};

const SHIPSGO_V2_CONFIG = {
  baseUrl: 'https://api.shipsgo.com/api/v2',
  token: process.env.SHIPSGO_V2_TOKEN || '505751c2-2745-4d83-b4e7-d35ccddd0628',
  headers: {
    'Authorization': 'Bearer 505751c2-2745-4d83-b4e7-d35ccddd0628',
    'Content-Type': 'application/json'
  }
};

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
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

    // Parse request body
    const { trackingId } = JSON.parse(event.body);

    if (!trackingId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tracking ID' })
      };
    }

    // Get tracking details
    const { data: tracking, error: fetchError } = await supabase
      .from('trackings')
      .select('*')
      .eq('id', trackingId)
      .eq('organizzazione_id', profile.organizzazione_id)
      .single();

    if (fetchError || !tracking) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tracking not found' })
      };
    }

    // Check if already deleted
    if (!tracking.active) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Tracking already deleted' })
      };
    }

    // Try to remove from ShipsGo first
    let shipsgoDeleted = false;
    let shipsgoError = null;

    if (tracking.metadata?.shipsgo_container_id) {
      // V1.2 - Maritime container
      try {
        const response = await fetch(
          `${SHIPSGO_V1_CONFIG.baseUrl}/tracking/${tracking.metadata.shipsgo_container_id}`,
          {
            method: 'DELETE',
            headers: SHIPSGO_V1_CONFIG.headers
          }
        );

        if (response.ok) {
          shipsgoDeleted = true;
        } else {
          const errorText = await response.text();
          console.error('ShipsGo V1.2 delete error:', errorText);
          shipsgoError = `ShipsGo error: ${response.status}`;
        }
      } catch (error) {
        console.error('ShipsGo V1.2 delete failed:', error);
        shipsgoError = error.message;
      }
    } else if (tracking.metadata?.shipsgo_tracking_id) {
      // V2.0 - Air cargo
      try {
        const response = await fetch(
          `${SHIPSGO_V2_CONFIG.baseUrl}/trackings/${tracking.metadata.shipsgo_tracking_id}`,
          {
            method: 'DELETE',
            headers: SHIPSGO_V2_CONFIG.headers
          }
        );

        if (response.ok) {
          shipsgoDeleted = true;
        } else {
          const errorText = await response.text();
          console.error('ShipsGo V2.0 delete error:', errorText);
          shipsgoError = `ShipsGo error: ${response.status}`;
        }
      } catch (error) {
        console.error('ShipsGo V2.0 delete failed:', error);
        shipsgoError = error.message;
      }
    }

    // Soft delete in database
    const { error: updateError } = await supabase
      .from('trackings')
      .update({
        active: false,
        updated_at: new Date().toISOString(),
        metadata: {
          ...tracking.metadata,
          deleted_by: user.email,
          deleted_at: new Date().toISOString(),
          shipsgo_deleted: shipsgoDeleted,
          shipsgo_delete_error: shipsgoError
        }
      })
      .eq('id', trackingId);

    if (updateError) {
      console.error('Database update error:', updateError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to delete tracking' })
      };
    }

    // Create deletion event for audit trail
    await supabase
      .from('tracking_events')
      .insert([{
        tracking_id: trackingId,
        event_date: new Date().toISOString(),
        event_type: 'DELETED',
        event_code: 'DEL',
        location_name: 'System',
        description: `Tracking deleted by ${user.email}`,
        data_source: 'system',
        confidence_score: 1.0,
        raw_data: {
          deleted_by: user.email,
          shipsgo_deleted: shipsgoDeleted,
          shipsgo_error: shipsgoError
        }
      }]);

    // Return success
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Tracking deleted successfully',
        warning: shipsgoError ? 'Tracking removed from system but ShipsGo deletion failed' : null
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