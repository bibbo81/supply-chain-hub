const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { year, month } = event.queryStringParameters || {};
    const targetYear = year ? parseInt(year) : 2024;
    const targetMonth = month ? parseInt(month) : 1;

    console.log(`Fetching analytics for ${targetYear}-${targetMonth}`);

    // 1. Get main analytics from materialized view
    const { data: analytics, error: analyticsError } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear)
      .eq('created_month', targetMonth)
      .single();

    if (analyticsError && analyticsError.code !== 'PGRST116') {
      console.error('Analytics error:', analyticsError);
      throw analyticsError;
    }

    // 2. Get carrier performance
    const { data: carrierData, error: carrierError } = await supabase
      .from('shipments')
      .select('spedizioniere, costo_trasporto, stato_spedizione')
      .eq('created_year', targetYear)
      .eq('created_month', targetMonth);

    if (carrierError) {
      console.error('Carrier error:', carrierError);
      throw carrierError;
    }

    // Process carrier performance
    const carrierPerformance = {};
    carrierData?.forEach(shipment => {
      const carrier = shipment.spedizioniere || 'Unknown';
      if (!carrierPerformance[carrier]) {
        carrierPerformance[carrier] = {
          name: carrier,
          shipments: 0,
          totalCost: 0,
          delivered: 0
        };
      }
      carrierPerformance[carrier].shipments++;
      carrierPerformance[carrier].totalCost += shipment.costo_trasporto || 0;
      if (shipment.stato_spedizione === 'CONSEGNATO') {
        carrierPerformance[carrier].delivered++;
      }
    });

    // Convert to array and calculate averages
    const carrierStats = Object.values(carrierPerformance).map(carrier => ({
      ...carrier,
      avgCost: carrier.shipments > 0 ? carrier.totalCost / carrier.shipments : 0,
      deliveryRate: carrier.shipments > 0 ? (carrier.delivered / carrier.shipments) * 100 : 0
    }));

    // 3. Get recent shipments
    const { data: recentShipments, error: shipmentsError } = await supabase
      .from('shipments')
      .select('*')
      .eq('created_year', targetYear)
      .eq('created_month', targetMonth)
      .order('data_partenza', { ascending: false })
      .limit(10);

    if (shipmentsError) {
      console.error('Shipments error:', shipmentsError);
      throw shipmentsError;
    }

    // 4. Get monthly trends (last 6 months)
    const { data: trends, error: trendsError } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .order('created_year', { ascending: false })
      .order('created_month', { ascending: false })
      .limit(6);

    if (trendsError) {
      console.error('Trends error:', trendsError);
      throw trendsError;
    }

    // 5. Get status distribution
    const { data: statusData, error: statusError } = await supabase
      .from('shipments')
      .select('stato_spedizione')
      .eq('created_year', targetYear)
      .eq('created_month', targetMonth);

    if (statusError) {
      console.error('Status error:', statusError);
      throw statusError;
    }

    const statusDistribution = {};
    statusData?.forEach(shipment => {
      const status = shipment.stato_spedizione || 'Unknown';
      statusDistribution[status] = (statusDistribution[status] || 0) + 1;
    });

    // Prepare response
    const response = {
      analytics: analytics || {
        total_shipments: 0,
        total_revenue: 0,
        avg_cost: 0,
        delivered_count: 0,
        delivery_rate: 0,
        data_quality_score: 0,
        avg_delivery_days: 0
      },
      carrierPerformance: carrierStats,
      recentShipments: recentShipments || [],
      monthlyTrends: trends || [],
      statusDistribution,
      metadata: {
        year: targetYear,
        month: targetMonth,
        timestamp: new Date().toISOString(),
        recordsFound: {
          analytics: analytics ? 1 : 0,
          carriers: carrierStats.length,
          shipments: recentShipments?.length || 0,
          trends: trends?.length || 0
        }
      }
    };

    console.log('Response prepared:', JSON.stringify(response, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('API Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
