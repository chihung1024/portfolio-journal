// =========================================================================================
// == 通知模組 (notifications.js)
// == 職責：處理頁面右上角的快顯通知。
// =========================================================================================

export function showNotification(type, message) {
    const area = document.getElementById('notification-area');
    const color = type === 'success' ? 'bg-green-500' : (type === 'info' ? 'bg-blue-500' : 'bg-red-500');
    const icon = type === 'success' ? 'check-circle' : (type === 'info' ? 'info' : 'alert-circle');
    const notification = document.createElement('div');
    notification.className = `flex items-center ${color} text-white text-sm font-bold px-4 py-3 rounded-md shadow-lg mb-2`;
    notification.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 mr-2"></i><p>${message}</p>`;
    area.appendChild(notification);
    lucide.createIcons({ nodes: [notification.querySelector('i')] });
    setTimeout(() => {
        notification.style.transition = 'opacity 0.5s ease';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 500);
    }, 5000);
}
