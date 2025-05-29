// Supply Chain Hub - Main JavaScript (Fixed)
// Global variables
let charts = {};
const API_BASE = 'https://supply-chain-hub.netlify.app/api';

// Wait for Chart.js to load before initializing
function waitForChart() {
    return new Promise((resolve) => {
        if (typeof Chart !== 'undefined') {
            resolve();
        } else {
            setTimeout(() => waitForChart().then(resolve), 100);
        }
    });
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async function() {
    // Wait for Chart.js to load
    await waitForChart();
    initializeDashboard();
});

async function initializeDashboard() {
    try {
        showLoadingState();
        await Promise.all([
            loadDashboardStats(),
            loadAnalytics(),
            loadCarrierPerformance(),
            loadAIInsights()
        ]);
        hideLoadingState();
        console.log('Dashboard initialized successfully');
    } catch (error) {
        console.error('Dashboard initialization error:', error);
        handleError(error);
    }
}

function showLoadingState() {
    document.body.style.cursor = 'wait';
}

function hideLoadingState() {
    document.body.style.cursor = 'default';
}

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/dashboard-stats`);
        if (!response.ok) throw new Error('Failed to load dashboard stats');
        
        const data = await response.json();
        updateKPIs(data);
        updateHeaderStats(data);
    } catch (error) {
        console.warn('Using fallback data for dashboard stats');
        // Use fallback data
        const fallbackData = {
            total_revenue: 2500000,
            total_shipments: 15420,
            avg_delivery_time: 3.2,
            on_time_rate: 94.5,
            active_carriers: 28,
            revenue_trend: 12.5,
            shipments_trend: 8.3,
            delivery_trend: -5.2,
            on_time_trend: 2.1
        };
        updateKPIs(fallbackData);
        updateHeaderStats(fallbackData);
    }
}

function updateKPIs(data) {
    // Update KPI values with animation
    animateValue('totalRevenue', 0, data.total_revenue, '€', true);
    animateValue('totalShipments', 0, data.total_shipments);
    animateValue('avgDeliveryTime', 0, data.avg_delivery_time, 'd', false, 1);
    animateValue('onTimeRate', 0, data.on_time_rate, '%', false, 1);
    
    // Update trends
    updateTrend('revenueTrend', data.revenue_trend);
    updateTrend('shipmentsTrend', data.shipments_trend);
    updateTrend('deliveryTrend', data.delivery_trend);
    updateTrend('onTimeTrend', data.on_time_trend);
}

function updateHeaderStats(data) {
    const totalOrdersEl = document.getElementById('totalOrders');
    const activeCarriersEl = document.getElementById('activeCarriers');
    
    if (totalOrdersEl) totalOrdersEl.textContent = data.total_shipments?.toLocaleString() || '15,420';
    if (activeCarriersEl) activeCarriersEl.textContent = data.active_carriers || '28';
}

function animateValue(elementId, start, end, suffix = '', prefix = false, decimals = 0) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const duration = 2000; // 2 seconds
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const currentValue = start + (end - start) * easeOutCubic(progress);
        const displayValue = decimals > 0 ? currentValue.toFixed(decimals) : Math.floor(currentValue);
        
        if (prefix) {
            element.textContent = suffix + displayValue.toLocaleString();
        } else {
            element.textContent = displayValue.toLocaleString() + suffix;
        }
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function updateTrend(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const isPositive = value > 0;
    
    element.textContent = `${isPositive ? '+' : ''}${value.toFixed(1)}%`;
    element.parentElement.className = `kpi-trend ${isPositive ? 'trend-positive' : 'trend-negative'}`;
    
    const icon = element.parentElement.querySelector('i');
    if (icon) {
        icon.className = `fas fa-arrow-${isPositive ? 'up' : 'down'}`;
    }
}

async function loadAnalytics() {
    try {
        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        
        const response = await fetch(`${API_BASE}/analytics/${year}/${month}`);
        if (!response.ok) throw new Error('Failed to load analytics');
        
        const data = await response.json();
        createRevenueChart(data.revenue_data || []);
        createShipmentChart(data.shipment_data || []);
        createPerformanceChart(data.performance_data || []);
    } catch (error) {
        console.warn('Using demo charts for analytics');
        createDemoCharts();
    }
}

function createRevenueChart(data) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    if (charts.revenue) {
        charts.revenue.destroy();
    }
    
    charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.date) || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'Revenue (€)',
                data: data.map(d => d.revenue) || [180000, 220000, 195000, 275000, 310000, 285000],
                borderColor: '#00ff88',
                backgroundColor: 'rgba(0, 255, 136, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#00ff88',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#a0a0a0' },
                    grid: { color: 'rgba(0, 255, 136, 0.1)' }
                },
                y: {
                    ticks: { 
                        color: '#a0a0a0',
                        callback: function(value) {
                            return '€' + (value / 1000) + 'K';
                        }
                    },
                    grid: { color: 'rgba(0, 255, 136, 0.1)' }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

function createShipmentChart(data) {
    const ctx = document.getElementById('shipmentChart');
    if (!ctx) return;
    
    if (charts.shipment) {
        charts.shipment.destroy();
    }
    
    charts.shipment = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.date) || ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
            datasets: [{
                label: 'Shipments',
                data: data.map(d => d.shipments) || [3420, 2890, 4150, 3680],
                backgroundColor: 'rgba(0, 255, 136, 0.2)',
                borderColor: '#00ff88',
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#a0a0a0' },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#a0a0a0' },
                    grid: { color: 'rgba(0, 255, 136, 0.1)' }
                }
            }
        }
    });
}

function createPerformanceChart(data) {
    const ctx = document.getElementById('performanceChart');
    if (!ctx) return;
    
    if (charts.performance) {
        charts.performance.destroy();
    }
    
    charts.performance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['On Time', 'Delayed', 'Early'],
            datasets: [{
                data: [94.5, 4.2, 1.3],
                backgroundColor: [
                    '#00ff88',
                    '#ff4444',
                    '#ffaa00'
                ],
                borderWidth: 0,
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#a0a0a0',
                        padding: 20,
                        usePointStyle: true
                    }
                }
            }
        }
    });
}

function createGeoChart() {
    const ctx = document.getElementById('geoChart');
    if (!ctx) return;
    
    if (charts.geo) {
        charts.geo.destroy();
    }
    
    charts.geo = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels: ['Europe', 'North America', 'Asia', 'South America', 'Africa'],
            datasets: [{
                data: [35, 28, 22, 10, 5],
                backgroundColor: [
                    'rgba(0, 255, 136, 0.8)',
                    'rgba(0, 255, 136, 0.6)',
                    'rgba(0, 255, 136, 0.4)',
                    'rgba(0, 255, 136, 0.3)',
                    'rgba(0, 255, 136, 0.2)'
                ],
                borderColor: '#00ff88',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#a0a0a0',
                        padding: 15
                    }
                }
            },
            scales: {
                r: {
                    ticks: { color: '#a0a0a0' },
                    grid: { color: 'rgba(0, 255, 136, 0.1)' }
                }
            }
        }
    });
}

async function loadCarrierPerformance() {
    try {
        const response = await fetch(`${API_BASE}/carriers/performance`);
        if (!response.ok) throw new Error('Failed to load carrier performance');
        
        const data = await response.json();
        displayCarrierPerformance(data.carriers || []);
    } catch (error) {
        console.warn('Using fallback data for carrier performance');
        displayCarrierPerformance([
            { name: 'DHL Express', rating: 4.8, deliveries: 2840, on_time: 96.2 },
            { name: 'FedEx International', rating: 4.6, deliveries: 2156, on_time: 94.8 },
            { name: 'UPS Worldwide', rating: 4.5, deliveries: 1923, on_time: 93.1 },
            { name: 'TNT Express', rating: 4.3, deliveries: 1456, on_time: 91.7 }
        ]);
    }
}

function displayCarrierPerformance(carriers) {
    const container = document.getElementById('carrierPerformanceContainer');
    if (!container) return;
    
    const tableHTML = `
        <table class="performance-table">
            <thead>
                <tr>
                    <th>Carrier</th>
                    <th>Rating</th>
                    <th>Deliveries</th>
                    <th>On-Time %</th>
                </tr>
            </thead>
            <tbody>
                ${carriers.map(carrier => `
                    <tr>
                        <td>${carrier.name}</td>
                        <td>⭐ ${carrier.rating}</td>
                        <td>${carrier.deliveries.toLocaleString()}</td>
                        <td>${carrier.on_time}%</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

async function loadAIInsights() {
    try {
        const response = await fetch(`${API_BASE}/insights/ai`);
        if (!response.ok) throw new Error('Failed to load AI insights');
        
        const data = await response.json();
        displayAIInsights(data.insights || []);
    } catch (error) {
        console.warn('Using fallback data for AI insights');
        displayAIInsights([
            {
                title: 'Route Optimization Opportunity',
                description: 'AI detected 15% cost reduction potential by optimizing European delivery routes.',
                priority: 'high'
            },
            {
                title: 'Demand Forecast Alert',
                description: 'Expected 23% increase in shipment volume for Q2 based on market trends.',
                priority: 'medium'
            },
            {
                title: 'Carrier Performance Insight',
                description: 'DHL Express showing consistent improvement in delivery times this quarter.',
                priority: 'low'
            }
        ]);
    }
}

function displayAIInsights(insights) {
    const container = document.getElementById('aiInsightsContainer');
    if (!container) return;
    
    const insightsHTML = insights.map(insight => `
        <div class="insight-item">
            <div class="insight-title">${insight.title}</div>
            <div class="insight-description">${insight.description}</div>
        </div>
    `).join('');
    
    container.innerHTML = insightsHTML;
}

function createDemoCharts() {
    // Fallback demo charts if API fails
    createRevenueChart([]);
    createShipmentChart([]);
    createPerformanceChart([]);
    createGeoChart();
}

function handleError(error) {
    console.error('Dashboard error:', error);
    // Could add user notification here
}

// Initialize geo chart after page load
setTimeout(() => {
    createGeoChart();
}, 2000);

// Auto-refresh every 5 minutes
setInterval(() => {
    console.log('Auto-refreshing dashboard data...');
    loadDashboardStats();
    loadAnalytics();
}, 300000);
