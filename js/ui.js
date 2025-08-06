<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>股票交易紀錄與資產分析系統 (模組化版)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <script src="https://cdn.jsdelivr.net/npm/lucide@0.378.0/dist/umd/lucide.min.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', 'Noto Sans TC', sans-serif; background-color: #f0f2f5; }
        .card { background-color: white; border-radius: 0.75rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); transition: all 0.3s ease-in-out; }
        .btn { transition: all 0.2s ease-in-out; }
        .modal-backdrop { background-color: rgba(0,0,0,0.5); transition: opacity 0.3s ease; }
    </style>
</head>
<body class="text-gray-800">

    <div id="app" class="min-h-screen">
        <div id="notification-area" class="fixed top-5 right-5 z-50"></div>

        <header class="bg-white shadow-md sticky top-0 z-20">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                <div class="flex items-center space-x-3">
                    <i data-lucide="line-chart" class="text-indigo-600 h-8 w-8"></i>
                    <h1 class="text-2xl font-bold text-gray-800">交易紀錄與資產分析</h1>
                </div>
                <div id="auth-status-display" class="flex items-center space-x-4 text-xs text-gray-500 text-right">
                    <div id="user-info" class="hidden">
                        <span id="auth-status"></span>
                        <p id="user-id" class="truncate max-w-[150px] sm:max-w-xs"></p>
                    </div>
                    <button id="logout-btn" class="hidden btn bg-red-500 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-red-600">登出</button>
                </div>
            </div>
        </header>
        
        <div id="auth-container" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
             <div class="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
                <h2 class="text-2xl font-bold text-center text-gray-800 mb-6">登入或註冊</h2>
                <form id="auth-form">
                    <div class="mb-4">
                        <label for="email" class="block text-sm font-medium text-gray-700 mb-1">電子郵件</label>
                        <input type="email" id="email" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required>
                    </div>
                    <div class="mb-6">
                        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">密碼</label>
                        <input type="password" id="password" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required>
                    </div>
                    <div class="flex items-center justify-between space-x-4">
                        <button type="button" id="login-btn" class="w-full btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700">登入</button>
                        <button type="button" id="register-btn" class="w-full btn bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-gray-700">註冊</button>
                    </div>
                </form>
            </div>
        </div>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 hidden">
            <div id="loading-overlay" class="fixed inset-0 bg-white bg-opacity-75 flex items-center justify-center z-40" style="display: none;">
                <div class="flex flex-col items-center text-center p-4">
                    <svg class="animate-spin h-10 w-10 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <p id="loading-text" class="mt-4 text-lg font-medium text-gray-700">正在驗證您的身分...</p>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">總資產 (TWD)</h3><i data-lucide="wallet" class="h-6 w-6 text-gray-400"></i></div><p id="total-assets" class="text-3xl font-bold text-gray-800 mt-2">0</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">未實現損益 (TWD)</h3><i data-lucide="trending-up" class="h-6 w-6 text-gray-400"></i></div><p id="unrealized-pl" class="text-3xl font-bold text-gray-800 mt-2">0</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">已實現損益 (TWD)</h3><i data-lucide="dollar-sign" class="h-6 w-6 text-gray-400"></i></div><p id="realized-pl" class="text-3xl font-bold text-gray-800 mt-2">0</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">總報酬率</h3><i data-lucide="percent" class="h-6 w-6 text-gray-400"></i></div><p id="total-return" class="text-3xl font-bold text-gray-800 mt-2">0.00%</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">XIRR 年化報酬率</h3><i data-lucide="calendar-check" class="h-6 w-6 text-gray-400"></i></div><p id="xirr-value" class="text-3xl font-bold text-gray-800 mt-2">0.00%</p></div>
            </div>

            <div class="card p-6 mb-8">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <div class="sm:flex sm:items-center sm:space-x-4"><h2 class="text-xl font-bold text-gray-800">投資組合</h2><div class="mt-2 sm:mt-0 border-b sm:border-b-0 sm:border-l border-gray-200 sm:pl-4"><nav class="-mb-px flex space-x-6" id="tabs"><a href="#" data-tab="holdings" class="tab-item whitespace-nowrap border-b-2 font-medium text-sm border-indigo-500 text-indigo-600">持股一覽</a><a href="#" data-tab="transactions" class="tab-item whitespace-nowrap border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">交易紀錄</a><a href="#" data-tab="splits" class="tab-item whitespace-nowrap border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">拆股事件</a></nav></div></div>
                    <div class="flex space-x-2">
                        <button id="manage-splits-btn" class="btn bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-gray-700 flex items-center space-x-2"><i data-lucide="git-merge" class="h-5 w-5"></i><span>管理拆股</span></button>
                        <button id="add-transaction-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 flex items-center space-x-2"><i data-lucide="plus-circle" class="h-5 w-5"></i><span>新增交易</span></button>
                    </div>
                </div>
                <div id="holdings-tab" class="tab-content">
                    <div id="holdings-content">
                        <!-- JavaScript 將在此處渲染表格或卡片 -->
                    </div>
                </div>
                <div id="transactions-tab" class="tab-content overflow-x-auto hidden"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">類型</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">價格(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">總金額(TWD)</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th></tr></thead><tbody id="transactions-table-body" class="bg-white divide-y divide-gray-200"></tbody></table></div>
                <div id="splits-tab" class="tab-content overflow-x-auto hidden"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">比例</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th></tr></thead><tbody id="splits-table-body" class="bg-white divide-y divide-gray-200"></tbody></table></div>
            </div>
            
            <div class="card p-6 mb-8">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <h3 class="text-lg font-semibold text-gray-800">時間加權報酬率 vs. Benchmark</h3>
                    <div class="flex items-center space-x-2">
                        <input type="text" id="benchmark-symbol-input" placeholder="e.g., SPY" class="w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                        <button id="update-benchmark-btn" class="btn bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 flex items-center space-x-2">
                            <i data-lucide="refresh-cw" class="h-5 w-5"></i>
                            <span>更新</span>
                        </button>
                    </div>
                </div>
                <div id="twr-chart"></div>
            </div>
            
            <div class="card p-6">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">資產成長曲線 (TWD)</h3>
                <div id="asset-chart"></div>
            </div>
        </main>

        <div id="transaction-modal" class="fixed inset-0 z-30 overflow-y-auto hidden"><div class="flex items-center justify-center min-h-screen"><div class="fixed inset-0 modal-backdrop" ></div><div class="bg-white rounded-lg shadow-xl p-8 z-40 w-full max-w-md mx-4"><h3 id="modal-title" class="text-2xl font-bold mb-6 text-gray-800">新增交易紀錄</h3><form id="transaction-form"><input type="hidden" id="transaction-id"><div class="mb-4"><label for="transaction-date" class="block text-sm font-medium text-gray-700 mb-1">日期</label><input type="date" id="transaction-date" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label for="stock-symbol" class="block text-sm font-medium text-gray-700 mb-1">股票代碼</label><input type="text" id="stock-symbol" placeholder="例如: AAPL, 2330.TW" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label class="block text-sm font-medium text-gray-700 mb-1">交易類型</label><div class="flex space-x-4"><label class="flex items-center"><input type="radio" name="transaction-type" value="buy" class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500" checked><span class="ml-2 text-gray-700">買入</span></label><label class="flex items-center"><input type="radio" name="transaction-type" value="sell" class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"><span class="ml-2 text-gray-700">賣出</span></label></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><div><label for="quantity" class="block text-sm font-medium text-gray-700 mb-1">股數</label><input type="number" step="any" id="quantity" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div><label for="price" class="block text-sm font-medium text-gray-700 mb-1">價格 (原幣)</label><input type="number" step="any" id="price" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div></div><div class="mb-4"><label for="currency" class="block text-sm font-medium text-gray-700 mb-1">幣別</label><select id="currency" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"><option value="USD">USD</option><option value="TWD">TWD</option><option value="HKD">HKD</option><option value="JPY">JPY</option></select></div>
                <div id="exchange-rate-field" class="space-y-4 mb-4 p-4 border border-gray-200 rounded-md" style="display: none;">
                    <label for="exchange-rate" class="block text-sm font-medium text-gray-700 mb-1">手動匯率 (選填)</label>
                    <input type="number" step="any" id="exchange-rate" placeholder="留空則自動抓取" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                </div>
                <div id="total-cost-field" class="space-y-4 mb-4 p-4 border border-gray-200 rounded-md">
                    <label for="total-cost" class="block text-sm font-medium text-gray-700 mb-1">總成本 (含費用, 原幣, 選填)</label>
                    <input type="number" step="any" id="total-cost" placeholder="留空則自動計算 (股數*價格)" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                </div>
                <div class="flex justify-end space-x-4 mt-6"><button type="button" id="cancel-btn" class="btn bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">取消</button><button type="submit" id="save-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 flex items-center justify-center">儲存</button></div></form></div></div></div>
        <div id="split-modal" class="fixed inset-0 z-30 overflow-y-auto hidden"><div class="flex items-center justify-center min-h-screen"><div class="fixed inset-0 modal-backdrop"></div><div class="bg-white rounded-lg shadow-xl p-8 z-40 w-full max-w-md mx-4"><h3 class="text-2xl font-bold mb-6 text-gray-800">新增拆股/合股事件</h3><form id="split-form"><input type="hidden" id="split-id"><div class="mb-4"><label for="split-date" class="block text-sm font-medium text-gray-700 mb-1">日期</label><input type="date" id="split-date" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label for="split-symbol" class="block text-sm font-medium text-gray-700 mb-1">股票代碼</label><input type="text" id="split-symbol" placeholder="例如: AAPL, 2330.TW" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label for="split-ratio" class="block text-sm font-medium text-gray-700 mb-1">比例</label><input type="number" step="any" id="split-ratio" placeholder="1拆10, 輸入10; 10合1, 輸入0.1" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="flex justify-end space-x-4 mt-6"><button type="button" id="cancel-split-btn" class="btn bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">取消</button><button type="submit" id="save-split-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700">儲存</button></div></form></div></div></div>
        <div id="confirm-modal" class="fixed inset-0 z-50 overflow-y-auto hidden"><div class="flex items-center justify-center min-h-screen"><div class="fixed inset-0 modal-backdrop"></div><div class="bg-white rounded-lg shadow-xl p-8 z-50 w-full max-w-sm mx-4"><h3 id="confirm-title" class="text-lg font-semibold mb-4 text-gray-800">確認操作</h3><p id="confirm-message" class="text-gray-600 mb-6">您確定要執行此操作嗎？</p><div class="flex justify-end space-x-4"><button id="confirm-cancel-btn" class="btn bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">取消</button><button id="confirm-ok-btn" class="btn bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-red-700">確定</button></div></div></div></div>
    </div>
    
    <script type="module" src="./js/main.js"></script>
</body>
</html>
