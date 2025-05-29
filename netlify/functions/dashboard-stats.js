import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event, context) => {
  // Headers CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  try {
    // Inizializza client Supabase
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Estrai parametri dalla query string
    const { year = 2024, month = 1 } = event.queryStringParameters || {};
    const targetYear = parseInt(year);
    const targetMonth = parseInt(month);

    console.log(`Fetching data for ${targetYear}-${targetMonth}`);

    // Nome del mese per il frontend
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[targetMonth - 1];

    // Date range per il mese target
    const startDate = `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`;
    const endDate = targetMonth === 12 
      ? `${targetYear + 1}-01-01` 
      : `${targetYear}-${(targetMonth + 1).toString().padStart(2, '0')}-01`;

    console.log(`Date range: ${startDate} to ${endDate}`);

    // 1. QUERY PRINCIPALE: Dati analytics dalla vista materializzata
    const { data: analyticsData, error: analyticsError } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear)
      .eq('created_month', targetMonth)
      .single();

    if (analyticsError && analyticsError.code !== 'PGRST116') {
      console.error('Analytics query error:', analyticsError);
    }

    console.log('Analytics data:', analyticsData);

    // 2. QUERY: Spedizioni del mese per distribuzione stati e carrier performance
    const { data: shipmentsData, error: shipmentsError } = await supabase
      .from('shipments')
      .select(`
        id,
        order_number,
        carrier,
        status,
        cost,
        shipment_date,
        delivery_date,
        origin,
        destination
      `)
      .gte('shipment_date', startDate)
      .lt('shipment_date', endDate);

    if (shipmentsError) {
      console.error('Shipments query error:', shipmentsError);
    }

    console.log('Shipments data:', shipmentsData);

    // 3. QUERY: Dati mese precedente per calcolare crescita
    let prevYear = targetYear;
    let prevMonth = targetMonth - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear = targetYear - 1;
    }

    const { data: prevAnalyticsData } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', prevYear)
      .eq('created_month', prevMonth)
      .single();

    console.log('Previous month data:', prevAnalyticsData);

    // 4. QUERY: Dati annuali per charts
    const { data: yearlyData } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear)
      .order('created_month', { ascending: true });

    console.log('Yearly data:', yearlyData);

    // PROCESSA I DATI
    
    // Dati correnti (usa dati reali o default)
    const current = analyticsData || {
      total_shipments: shipmentsData ? shipmentsData.length : 0,
      total_revenue: shipmentsData ? shipmentsData.reduce((sum, s) => sum + (s.cost || 0), 0) : 0,
      avg_cost: 0,
      delivery_rate: 0,
      data_quality_score: 100
    };

    // Se non abbiamo dati dalla vista, calcoliamo dai shipments
    if (!analyticsData && shipmentsData && shipmentsData.length > 0) {
      const totalCost = shipmentsData.reduce((sum, s) => sum + (s.cost || 0), 0);
      const deliveredCount = shipmentsData.filter(s => 
        s.status && s.status.toLowerCase() === 'consegnato'
      ).length;
      
      current.avg_cost = Math.round(totalCost / shipmentsData.length);
      current.delivery_rate = Math.round((deliveredCount / shipmentsData.length) * 100);
    }

    console.log('Processed current data:', current);

    // Dati precedenti per crescita
    const previous = prevAnalyticsData || {
      total_shipments: 0,
      total_revenue: 0,
      avg_cost: 0,
      delivery_rate: 0
    };

    // Calcola crescita month-over-month
    const calculateGrowth = (current, previous) => {
      if (previous === 0) return { value: current, percentage: current > 0 ? 100 : 0 };
      const growth = current - previous;
      const percentage = (growth / previous) * 100;
      return {
        value: growth,
        percentage: Math.round(percentage * 100) / 100
      };
    };

    // DISTRIBUZIONE STATI
    const statusDistribution = {
      consegnato: 0,
      in_transito: 0,
      arrivato: 0,
      other: 0
    };

    if (shipmentsData) {
      shipmentsData.forEach(shipment => {
        const status = shipment.status ? shipment.status.toLowerCase().trim() : '';
        console.log('Processing status:', status);
        
        if (status === 'consegnato') {
          statusDistribution.consegnato++;
        } else if (status === 'in transito' || status === 'in_transito') {
          statusDistribution.in_transito++;
        } else if (status === 'arrivato') {
          statusDistribution.arrivato++;
        } else {
          statusDistribution.other++;
        }
      });
    }

    console.log('Status distribution:', statusDistribution);

    // CARRIER PERFORMANCE
    const carrierPerformance = [];
    if (shipmentsData && shipmentsData.length > 0) {
      const carrierStats = {};
      
      shipmentsData.forEach(shipment => {
        const carrier = shipment.carrier || 'Unknown';
        if (!carrierStats[carrier]) {
          carrierStats[carrier] = {
            shipments: 0,
            totalCost: 0,
            delivered: 0,
            onTime: 0
          };
        }
        
        carrierStats[carrier].shipments++;
        carrierStats[carrier].totalCost += shipment.cost || 0;
        
        if (shipment.status && shipment.status.toLowerCase() === 'consegnato') {
          carrierStats[carrier].delivered++;
        }
        
        // Calcola on-time delivery (se consegnato entro 7 giorni)
        if (shipment.delivery_date && shipment.shipment_date) {
          const shipDate = new Date(shipment.shipment_date);
          const deliveryDate = new Date(shipment.delivery_date);
          const daysDiff = (deliveryDate - shipDate) / (1000 * 60 * 60 * 24);
          
          if (daysDiff <= 7) {
            carrierStats[carrier].onTime++;
          }
        }
      });

      // Converti in array per il frontend
      Object.entries(carrierStats).forEach(([carrier, stats]) => {
        const avgCost = stats.shipments > 0 ? Math.round(stats.totalCost / stats.shipments) : 0;
        const deliveryRate = stats.shipments > 0 ? Math.round((stats.delivered / stats.shipments) * 100) : 0;
        const onTimeRate = stats.shipments > 0 ? Math.round((stats.onTime / stats.shipments) * 100) : 0;
        
        carrierPerformance.push({
          carrier,
          shipments: stats.shipments,
          avgCost,
          deliveryRate,
          onTimeRate,
          marketShare: Math.round((stats.shipments / shipmentsData.length) * 100)
        });
      });
    }

    console.log('Carrier performance:', carrierPerformance);

    // CHARTS DATA
    const chartLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const currentYearData = new Array(12).fill(0);
    const previousYearData = new Array(12).fill(0);

    // Popola dati correnti
    if (yearlyData) {
      yearlyData.forEach(item => {
        const monthIndex = item.created_month - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          currentYearData[monthIndex] = item.total_shipments || 0;
        }
      });
    }

    // Query per anno precedente
    const { data: prevYearData } = await supabase
      .from('mv_analytics_monthly')
      .select('*')
      .eq('created_year', targetYear - 1)
      .order('created_month', { ascending: true });

    if (prevYearData) {
      prevYearData.forEach(item => {
        const monthIndex = item.created_month - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          previousYearData[monthIndex] = item.total_shipments || 0;
        }
      });
    }

    // INSIGHTS E PERFORMANCE
    const totalShipments = current.total_shipments || 0;
    const totalRevenue = current.total_revenue || 0;
    const deliveryRate = current.delivery_rate || 0;

    const insights = {
      summary: `Performance analytics for ${monthName} ${targetYear}`,
      keyFindings: [
        `${totalShipments} total shipments processed`,
        `€${totalRevenue.toLocaleString()} in total revenue`,
        `${deliveryRate}% delivery success rate`
      ],
      recommendations: [
        deliveryRate < 50 ? 'Focus on improving delivery performance' : 'Maintain current service levels',
        totalShipments > 0 ? 'Continue monitoring carrier performance' : 'Increase shipment volume'
      ]
    };

    const performance = {
      dataQuality: {
        score: current.data_quality_score || 100,
        status: (current.data_quality_score || 100) >= 90 ? 'excellent' : 'good'
      },
      systemHealth: {
        status: 'operational',
        uptime: 99.9,
        lastUpdate: new Date().toISOString()
      }
    };

    // ALERTS
    const alerts = [];
    if (deliveryRate < 50 && totalShipments > 0) {
      alerts.push({
        type: 'warning',
        message: 'Delivery rate below 50% - review carrier performance',
        priority: 'high'
      });
    }
    if (totalShipments === 0) {
      alerts.push({
        type: 'info',
        message: 'No shipments recorded for this period',
        priority: 'medium'
      });
    }

    // RECENT SHIPMENTS per tabella
    const recentShipments = shipmentsData ? shipmentsData.slice(0, 10).map(shipment => ({
      orderNumber: shipment.order_number || shipment.id,
      carrier: shipment.carrier || 'Unknown',
      status: shipment.status || 'Unknown',
      cost: shipment.cost || 0,
      date: shipment.shipment_date || new Date().toISOString().split('T')[0]
    })) : [];

    // COSTRUISCI RISPOSTA FINALE
    const response = {
      success: true,
      period: {
        year: targetYear,
        month: targetMonth,
        monthName: monthName
      },
      current: {
        month: {
          shipments: totalShipments,
          revenue: totalRevenue,
          avgCost: current.avg_cost || 0,
          deliveryRate: deliveryRate
        }
      },
      growth: {
        mom: {
          shipments: calculateGrowth(totalShipments, previous.total_shipments),
          revenue: calculateGrowth(totalRevenue, previous.total_revenue),
          avgCost: calculateGrowth(current.avg_cost || 0, previous.avg_cost)
        }
      },
      charts: {
        labels: chartLabels,
        shipments: {
          current: currentYearData,
          previous: previousYearData
        }
      },
      status: {
        distribution: statusDistribution
      },
      insights: insights,
      performance: performance,
      alerts: alerts,
      carrierPerformance: carrierPerformance,
      recentShipments: recentShipments
    };

    console.log('Final response summary:', {
      success: response.success,
      currentShipments: response.current.month.shipments,
      carrierCount: response.carrierPerformance.length,
      recentShipmentsCount: response.recentShipments.length
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Dashboard Stats Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
