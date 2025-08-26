import { stagingService } from '../staging.service.js';
import { showLoading, hideLoading } from '../ui/utils.js';

async function renderStagingModal() {
  const actions = await stagingService.getActions();
  const modalBody = document.getElementById('staging-modal-body');
  
  if (actions.length === 0) {
    modalBody.innerHTML = '<p>暫存區是空的。</p>';
    return;
  }

  // A simple table to display the actions
  modalBody.innerHTML = `
    <table class="table table-sm">
      <thead>
        <tr>
          <th>類型</th>
          <th>實體</th>
          <th>內容</th>
          <th>時間</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${'``'}
      </tbody>
    </table>
  `;
}

export async function updateStagedCountBadge() {
    const actions = await stagingService.getActions();
    const badge = document.getElementById('staged-count-badge');
    if (badge) {
        if (actions.length > 0) {
            badge.textContent = actions.length;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }
}

export function initializeStagingEventListeners() {
  const submitAllBtn = document.getElementById('submit-all-btn');
  const stagingModal = document.getElementById('staging-modal');

  if (submitAllBtn) {
    submitAllBtn.addEventListener('click', async () => {
      if (confirm('確定要提交所有暫存的變更嗎？這將會觸發一次全局計算。')) {
        showLoading();
        try {
          await stagingService.submitAll();
          alert('變更已成功提交！');
          await updateStagedCountBadge();
          // TODO: Refresh dashboard or relevant parts of the UI
        } catch (error) {
          console.error('Submission failed', error);
          alert('提交失敗，請查看控制台以獲取更多資訊。');
        } finally {
          hideLoading();
        }
      }
    });
  }

  if (stagingModal) {
    stagingModal.addEventListener('show.bs.modal', async () => {
      await renderStagingModal();
    });

    stagingModal.addEventListener('click', async (event) => {
        if (event.target.matches('[data-action-id]')) {
            const actionId = event.target.getAttribute('data-action-id');
            if (confirm('確定要移除這個暫存的變更嗎？')) {
                showLoading();
                await stagingService.removeAction(actionId);
                await renderStagingModal(); // Re-render the modal content
                await updateStagedCountBadge();
                hideLoading();
            }
        }
    });
  }

  // Initial update of the badge
  updateStagedCountBadge();
}
