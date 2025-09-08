// =========================================================================================
// == 檔案：js/ui/charts/chart.common.js (v_chart_contract_fix_final)
// == 職責：提供所有圖表共享的設定、顏色與實例管理器，並履行其模組契約
// =========================================================================================

const chartColors = {
    blue: 'rgba(54, 162, 235, 1)',
    green: 'rgba(75, 192, 192, 1)',
    red: 'rgba(255, 99, 132, 1)',
    gray: 'rgba(201, 203, 207, 1)'
};

// 用於追蹤並管理所有圖表實例，以便在更新時能先銷毀舊的實例
const CHART_INSTANCE_MAP = {
    assetChart: null,
    twrChart: null,
    netProfitChart: null,
};

const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        mode: 'index',
        intersect: false,
    },
    plugins: {
        legend: {
            position: 'top',
        },
        tooltip: {
            enabled: true,
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleFont: {
                size: 14,
            },
            bodyFont: {
                size: 12,
            },
            padding: 10,
            caretSize: 5,
            cornerRadius: 4,
        }
    },
    scales: {
        y: {
            beginAtZero: false,
            ticks: {
                color: '#6b7280', // text-gray-500
            },
            grid: {
                color: '#e5e7eb', // border-gray-200
            }
        },
        x: {
            ticks: {
                color: '#6b7280',
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 10
            },
            grid: {
                display: false
            }
        }
    }
};

// 【核心修正】: 將 CHART_INSTANCE_MAP 加入導出列表，以修復破損的模組契約
export { chartColors, commonChartOptions, CHART_INSTANCE_MAP };
