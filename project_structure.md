# 專案資料夾結構
```
└── portfolio-journal-main
    ├── .github
    │   └── workflows
    │       ├── update_prices.yml
    │       └── weekend_maintenance.yml
    ├── README.md
    ├── functions
    │   ├── api_handlers
    │   │   ├── dividend.handler.js
    │   │   ├── note.handler.js
    │   │   ├── portfolio.handler.js
    │   │   ├── split.handler.js
    │   │   └── transaction.handler.js
    │   ├── calculation
    │   │   ├── data.provider.js
    │   │   ├── helpers.js
    │   │   ├── metrics.calculator.js
    │   │   └── state.calculator.js
    │   ├── d1.client.js
    │   ├── index.js
    │   ├── middleware.js
    │   ├── package.json
    │   ├── performRecalculation.js
    │   └── schemas.js
    ├── index.html
    ├── js
    │   ├── api.js
    │   ├── auth.js
    │   ├── config.js
    │   ├── events
    │   │   ├── dividend.events.js
    │   │   ├── general.events.js
    │   │   ├── split.events.js
    │   │   └── transaction.events.js
    │   ├── main.js
    │   ├── state.js
    │   ├── ui
    │   │   ├── charts
    │   │   │   ├── assetChart.js
    │   │   │   ├── chart.common.js
    │   │   │   ├── netProfitChart.js
    │   │   │   └── twrChart.js
    │   │   ├── components
    │   │   │   ├── dividends.ui.js
    │   │   │   ├── holdings.ui.js
    │   │   │   ├── splits.ui.js
    │   │   │   └── transactions.ui.js
    │   │   ├── dashboard.js
    │   │   ├── modals.js
    │   │   ├── notifications.js
    │   │   ├── tabs.js
    │   │   └── utils.js
    │   └── ui.js
    ├── main.py
    ├── main_weekend.py
    ├── realtimedata.md
    └── worker.js
```