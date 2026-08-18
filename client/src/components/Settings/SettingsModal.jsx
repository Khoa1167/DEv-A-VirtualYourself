import { useState } from 'react';
import Modal from '../common/Modal';
import Toast from '../common/Toast';
import { useTheme } from '../../context/ThemeContext';
import api from '../../services/api';
import useTimedMessage from '../../hooks/useTimedMessage';

export default function SettingsModal({ onClose }) {
  const [tab, setTab] = useState('theme'); // 'theme' | 'password'
  const { theme, changeTheme, availableThemes } = useTheme();

  // ── Form đổi mật khẩu ──
  const [pwForm, setPwForm] = useState({
    currentPassword: '', newPassword: '', confirmPassword: ''
  });
  const [pwError, showPwError] = useTimedMessage();
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSuccess, showPwSuccess] = useTimedMessage();

  const handleChangePassword = async (e) => {
    e.preventDefault();
    showPwError('');
    showPwSuccess('');

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      showPwError('Mật khẩu mới xác nhận không khớp'); return;
    }

    setPwLoading(true);
    try {
      await api.put('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      showPwSuccess('Đổi mật khẩu thành công!');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      showPwError(err.response?.data?.message || 'Đổi mật khẩu thất bại');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <Modal onClose={onClose} boxClassName="p-0 max-w-lg bg-base-100 border border-base-300 shadow-2xl">
      <div className="p-5 pb-4 border-b border-base-300 flex items-center justify-between">
        <h2 className="text-lg font-bold">Cài đặt</h2>
        <button className="btn btn-sm btn-ghost bg-base-200 rounded-full" onClick={onClose}>✕ Đóng</button>
      </div>

      <div className="flex max-h-[70vh]">
        {/* Menu dọc */}
        <div className="w-36 flex-shrink-0 border-r border-base-300 p-3 flex flex-col gap-1">
          <button
            type="button"
            className={`btn btn-sm justify-start rounded-lg font-bold ${tab === 'theme' ? 'btn-primary text-white' : 'btn-ghost bg-transparent'}`}
            onClick={() => setTab('theme')}
          >
            Giao diện
          </button>
          <button
            type="button"
            className={`btn btn-sm justify-start rounded-lg font-bold ${tab === 'password' ? 'btn-primary text-white' : 'btn-ghost bg-transparent'}`}
            onClick={() => setTab('password')}
          >
            Đổi mật khẩu
          </button>
        </div>

        {/* Nội dung */}
        <div className="flex-1 overflow-y-auto p-6 hide-scrollbar">
          {/* Giao diện */}
          {tab === 'theme' && (
            <div className="grid grid-cols-2 gap-2">
              {availableThemes.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => changeTheme(t.id)}
                  className={`btn btn-sm justify-start rounded-lg ${theme === t.id ? 'btn-primary text-white' : 'btn-ghost bg-base-200'}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {/* Đổi mật khẩu */}
          {tab === 'password' && (
            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mật khẩu hiện tại</label>
                <input
                  type="password"
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={pwForm.currentPassword}
                  onChange={e => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Mật khẩu mới</label>
                <input
                  type="password"
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={pwForm.newPassword}
                  onChange={e => setPwForm({ ...pwForm, newPassword: e.target.value })}
                  required minLength={6}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-base-content/50 uppercase tracking-wider">Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  className="input input-bordered input-sm focus:input-primary w-full"
                  value={pwForm.confirmPassword}
                  onChange={e => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                  required
                />
              </div>

              <Toast message={pwError} type="error" variant="banner" alertClassName="py-2 px-3 text-xs font-semibold rounded-lg" />
              <Toast message={pwSuccess} type="success" variant="banner" alertClassName="py-2 px-3 text-xs font-semibold rounded-lg" />

              <button type="submit" className="btn btn-primary text-white rounded-full mt-2" disabled={pwLoading}>
                {pwLoading ? 'Đang đổi...' : 'Đổi mật khẩu'}
              </button>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
