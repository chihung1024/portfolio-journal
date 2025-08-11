// =========================================================================================
// == 圖表共用設定模組 (chart.common.js)
// == 職責：提供所有 ApexCharts 圖表實例的基礎設定。
// =========================================================================================

export const baseChartOptions = {
    chart: {
        type: 'area',
        height: 350,
        zoom: {
            enabled: true
        },
        toolbar: {
            show: true
        }
    },
    dataLabels: {
        enabled: false
    },
    stroke: {
        curve: 'smooth',
        width: 2
    },
    xaxis: {
        type: 'datetime',
        labels: {
            datetimeUTC: false,
            datetimeFormatter: {
                year: 'yyyy',
                month: "MMM",
                day: 'dd'
            }
        }
    },
    tooltip: {
        x: {
            format: 'yyyy-MM-dd'
        }
    }
};
