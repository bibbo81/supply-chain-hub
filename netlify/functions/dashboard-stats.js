const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Fetch shipments data
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Database error: ' + error.message
        })
      };
    }

    console.log('Fetched shipments:', shipments?.length || 0);

    // Calcola statistiche
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    // Filtra per anno/mese corrente (per demo usiamo gennaio 2024)
    const currentPeriodShipments = shipments?.filter(s => {
      const shipmentDate = new Date(s.created_at || s.date);
      return shipmentDate.getFullYear() === 2024 && shipmentDate.getMonth() + 1 === 1;
    }) || [];

    // Calcola KPI
    const totalShipments = currentPeriodShipments.length;
    const totalRevenue = currentPeriodShipments.reduce((sum, s) => sum + (parseFloat(s.cost) || 0), 0);
    const avgCost = totalShipments > 0 ? totalRevenue / totalShipments : 0;
    
    // Calcola delivery rate (percentuale di spedizioni consegnate)
    const deliveredShipments = currentPeriodShipments.filter(s => 
      s.status?.toLowerCase().includes('consegnat') || 
      s.status?.toLowerCase().includes('delivered')
    ).length;
    const deliveryRate = totalShipments > 0 ? Math.round((deliveredShipments / totalShipments) * 100) : 0;

    // Carrier performance
    const carrierStats = {};
    currentPeriodShipments.forEach(shipment => {
      const carrier = shipment.carrier || 'Unknown';
      if (!carrierStats[carrier]) {
        carrierStats[carrier] = { shipments: 0, delivered: 0 };
      }
      carrierStats[carrier].shipments++;
      if (shipment.status?.toLowerCase().includes('consegnat') || 
          shipment.status?.toLowerCase().includes('delivered')) {
        carrierStats[carrier].delivered++;
      }
    });

    const carrierPerformance = Object.entries(carrierStats).map(([carrier, stats]) => ({
      carrier,
      shipments: stats.shipments,
      deliveryRate: stats.shipments > 0 ? Math.round((stats.delivered / stats.shipments) * 100) : 0
    }));

    // Recent shipments (ultimi 10)
    const recentShipments = currentPeriodShipments.slice(0, 10).map(s => ({
      orderNumber: s.order_number || s.id || 'N/A',
      carrier: s.carrier || 'N/A',
      status: s.status || 'N/A',
      date: s.created_at ? new Date(s.created_at).toLocaleDateString('it-IT') : 'N/A',
      cost: s.cost || 0
    }));

    // Risposta finale
    const responseData = {
      success: true,
      timestamp: new Date().toISOString(),
      current: {
        month: {
          shipments: totalShipments,
          revenue: Math.round(totalRevenue),
          avgCost: Math.round(avgCost),
          deliveryRate: deliveryRate
        }
      },
      carrierPerformance,
      recentShipments,
      rawData: {
        totalShipments,
        totalRevenue,
        avgCost,
        deliveryRate,
        recordsFound: shipments?.length || 0
      }
    };

    console.log('Response data:', JSON.stringify(responseData, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData)
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error: ' + error.message
      })
    };
  }
};
